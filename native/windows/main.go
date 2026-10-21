//go:build windows

// launch.exe bootstraps Node and owns a Windows Job Object before starting any
// child. Closing its non-inherited handle terminates all task descendants,
// including detached children. Nested jobs separate each native task.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

func main() { os.Exit(run(os.Args[1:])) }

func run(args []string) int {
	if len(args) == 2 && args[0] == "--stop" {
		return stopJob(args[1])
	}
	var name, command, raw string
	var childArgs []string
	if len(args) >= 3 && args[0] == "--run" {
		name, command, childArgs = args[1], args[2], args[3:]
		if len(childArgs) == 2 && childArgs[0] == "--raw-cmd" {
			raw, childArgs = childArgs[1], nil
		}
	} else {
		var err error
		command, err = findNode()
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 125
		}
		exe, err := os.Executable()
		if err != nil {
			return 125
		}
		childArgs = append([]string{filepath.Join(filepath.Dir(exe), "main.mjs")}, args...)
		os.Setenv("PATH", filepath.Dir(command)+string(os.PathListSeparator)+os.Getenv("PATH"))
		var token [16]byte
		if _, err = rand.Read(token[:]); err != nil {
			return 125
		}
		name = "Local\\reasonix-subagent-runtime-" + hex.EncodeToString(token[:])
	}
	job, err := ownJob(name)
	if err != nil {
		fmt.Fprintln(os.Stderr, "windows_job_setup_failed")
		return 125
	}
	defer windows.CloseHandle(job)
	code, err := runChild(job, command, childArgs, raw)
	if err != nil {
		fmt.Fprintln(os.Stderr, "native_spawn_failed")
		return 125
	}
	if terminateJob(job) != 0 {
		return 125
	}
	return int(code)
}

// PROC_THREAD_ATTRIBUTE_JOB_LIST assigns the child at creation, before any
// user code runs. The supervisor stays outside its own job so it can wait for
// complete teardown before exiting (and releasing its installed executable).
func runChild(job windows.Handle, command string, args []string, raw string) (uint32, error) {
	attrs, err := windows.NewProcThreadAttributeList(2)
	if err != nil {
		return 0, err
	}
	defer attrs.Delete()
	if err = attrs.Update(0x0002000d, unsafe.Pointer(&job), unsafe.Sizeof(job)); err != nil {
		return 0, err
	}
	files := []*os.File{os.Stdin, os.Stdout, os.Stderr}
	handles := make([]windows.Handle, len(files))
	for i, file := range files {
		if err = windows.DuplicateHandle(windows.CurrentProcess(), windows.Handle(file.Fd()), windows.CurrentProcess(),
			&handles[i], 0, true, windows.DUPLICATE_SAME_ACCESS); err != nil {
			return 0, err
		}
		defer windows.CloseHandle(handles[i])
	}
	if err = attrs.Update(windows.PROC_THREAD_ATTRIBUTE_HANDLE_LIST, unsafe.Pointer(&handles[0]), uintptr(len(handles))*unsafe.Sizeof(handles[0])); err != nil {
		return 0, err
	}
	si := windows.StartupInfoEx{}
	si.Cb = uint32(unsafe.Sizeof(si))
	si.Flags = windows.STARTF_USESTDHANDLES | windows.STARTF_USESHOWWINDOW
	si.ShowWindow = windows.SW_HIDE
	si.StdInput, si.StdOutput, si.StdErr = handles[0], handles[1], handles[2]
	si.ProcThreadAttributeList = attrs.List()
	if raw == "" {
		raw = windows.ComposeCommandLine(append([]string{command}, args...))
	}
	app, err := windows.UTF16PtrFromString(command)
	if err != nil {
		return 0, err
	}
	line, err := windows.UTF16PtrFromString(raw)
	if err != nil {
		return 0, err
	}
	var process windows.ProcessInformation
	err = windows.CreateProcess(app, line, nil, nil, true, windows.EXTENDED_STARTUPINFO_PRESENT|windows.CREATE_UNICODE_ENVIRONMENT,
		nil, nil, &si.StartupInfo, &process)
	if err != nil {
		return 0, err
	}
	defer windows.CloseHandle(process.Process)
	windows.CloseHandle(process.Thread)
	if _, err = windows.WaitForSingleObject(process.Process, windows.INFINITE); err != nil {
		return 0, err
	}
	var code uint32
	err = windows.GetExitCodeProcess(process.Process, &code)
	return code, err
}

func ownJob(name string) (windows.Handle, error) {
	p, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 0, err
	}
	h, err := windows.CreateJobObject(nil, p)
	if err != nil {
		return 0, err
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(h, windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		windows.CloseHandle(h)
		return 0, err
	}
	return h, nil
}

func stopJob(name string) int {
	p, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 1
	}
	result, _, callErr := windows.NewLazySystemDLL("kernel32.dll").NewProc("OpenJobObjectW").Call(0x0008|0x0004, 0, uintptr(unsafe.Pointer(p)))
	h := windows.Handle(result)
	if h == 0 {
		err = callErr
	} else {
		err = nil
	}
	if errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
		return 2
	}
	if err != nil {
		return 1
	}
	defer windows.CloseHandle(h)
	return terminateJob(h)
}

func terminateJob(h windows.Handle) int {
	if err := windows.TerminateJobObject(h, 1); err != nil {
		return 1
	}
	deadline := time.Now().Add(5 * time.Second)
	// JOBOBJECT_BASIC_ACCOUNTING_INFORMATION: four int64, four uint32.
	var accounting struct {
		Times                             [4]int64
		Faults, Total, Active, Terminated uint32
	}
	for time.Now().Before(deadline) {
		err := windows.QueryInformationJobObject(h, windows.JobObjectBasicAccountingInformation,
			uintptr(unsafe.Pointer(&accounting)), uint32(unsafe.Sizeof(accounting)), nil)
		if err != nil {
			return 1
		}
		if accounting.Active == 0 {
			return 0
		}
		time.Sleep(20 * time.Millisecond)
	}
	return 1
}

func findNode() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", errors.New("home_directory_unavailable")
	}
	dir := os.Getenv("REASONIX_SUBAGENT_CONFIG_DIR")
	if dir == "" {
		dir = filepath.Join(home, ".reasonix", "native-subagents")
	}
	if !filepath.IsAbs(dir) {
		return "", errors.New("invalid_config_directory")
	}
	override := os.Getenv("REASONIX_SUBAGENT_NODE")
	if override == "" {
		data, err := os.ReadFile(filepath.Join(dir, "node-path"))
		if err == nil {
			override = strings.TrimSpace(string(data))
			if override == "" {
				return "", errors.New("invalid_node_override")
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", errors.New("node_override_unreadable")
		}
	}
	if override != "" {
		if !filepath.IsAbs(override) {
			return "", errors.New("invalid_node_override")
		}
		if _, ok := nodeVersion(override); !ok {
			return "", errors.New("node_override_requires_node_20")
		}
		return override, nil
	}
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		if !filepath.IsAbs(dir) {
			continue
		}
		p := filepath.Join(dir, "node.exe")
		if _, ok := nodeVersion(p); ok {
			return p, nil
		}
	}
	candidates := []string{}
	for _, dir := range []string{
		filepath.Join(os.Getenv("ProgramFiles"), "nodejs"), filepath.Join(os.Getenv("ProgramW6432"), "nodejs"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "nodejs"), filepath.Join(os.Getenv("LOCALAPPDATA"), "Volta", "bin"),
		filepath.Join(home, ".volta", "bin"), filepath.Join(home, "scoop", "apps", "nodejs", "current"),
		filepath.Join(home, "scoop", "apps", "nodejs-lts", "current"), os.Getenv("NVM_SYMLINK"),
	} {
		if filepath.IsAbs(dir) {
			candidates = append(candidates, filepath.Join(dir, "node.exe"))
		}
	}
	for _, root := range []string{os.Getenv("FNM_DIR"), filepath.Join(os.Getenv("APPDATA"), "fnm"), filepath.Join(os.Getenv("LOCALAPPDATA"), "fnm")} {
		if filepath.IsAbs(root) {
			matches, _ := filepath.Glob(filepath.Join(root, "node-versions", "*", "installation", "node.exe"))
			candidates = append(candidates, matches...)
		}
	}
	for _, root := range []string{os.Getenv("NVM_HOME"), filepath.Join(os.Getenv("APPDATA"), "nvm"), filepath.Join(os.Getenv("LOCALAPPDATA"), "nvm")} {
		if filepath.IsAbs(root) {
			matches, _ := filepath.Glob(filepath.Join(root, "v*", "node.exe"))
			candidates = append(candidates, matches...)
		}
	}
	best := ""
	var version [3]int
	for _, p := range candidates {
		if v, ok := nodeVersion(p); ok && (best == "" || newer(v, version)) {
			best, version = p, v
		}
	}
	if best == "" {
		return "", errors.New("node_20_not_found_install_node_or_set_node_path")
	}
	return best, nil
}

func nodeVersion(path string) ([3]int, bool) {
	var version [3]int
	if _, err := os.Stat(path); err != nil {
		return version, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "--version")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	// Probes must never wait on an unexpected interactive program indefinitely.
	out, err := cmd.Output()
	if err != nil {
		return version, false
	}
	parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(string(out)), "v"), ".")
	if len(parts) != 3 {
		return version, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return version, false
		}
		version[i] = n
	}
	return version, version[0] >= 20
}

func newer(a, b [3]int) bool {
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}
