package sidecar_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"reasonix/internal/ext/extension/protocol"
	"reasonix/internal/ext/extension/sidecar"
	"reasonix/internal/ext/installsource"
	"reasonix/internal/ext/pluginpkg"
)

func TestNativeSubagentMarketplacePackages(t *testing.T) {
	sourceRoot := os.Getenv("REASONIX_NATIVE_SOURCE")
	fixture := os.Getenv("REASONIX_NATIVE_FIXTURE")
	if sourceRoot == "" || fixture == "" {
		t.Fatal("REASONIX_NATIVE_SOURCE and REASONIX_NATIVE_FIXTURE must be set")
	}
	for _, spec := range []struct{ name, tool, env string }{
		{"codex-subagent", "subagent_codex", "REASONIX_CODEX_BIN"},
		{"claude-code-subagent", "subagent_claude_code", "REASONIX_CLAUDE_BIN"},
	} {
		t.Run(spec.name, func(t *testing.T) {
			home, workspace := t.TempDir(), t.TempDir()
			state := filepath.Join(home, ".reasonix")
			t.Setenv("REASONIX_HOME", state)
			t.Setenv("REASONIX_STATE_HOME", state)
			t.Setenv(spec.env, fixture)
			installer := installsource.NewTool(installsource.Options{
				ProjectRoot: workspace, HomeDir: home, RequireApprovedPlan: true,
			})
			args := map[string]any{
				"source": sourceRoot + "/" + spec.name, "kind": "plugin", "scope": "global", "mode": "copy",
			}
			install := func() map[string]any {
				raw, _ := json.Marshal(args)
				text, err := installer.Execute(t.Context(), raw)
				if err != nil {
					t.Fatal(err)
				}
				var result map[string]any
				if json.Unmarshal([]byte(text), &result) != nil || result["ok"] != true {
					t.Fatalf("install: %s", text)
				}
				return result
			}
			preview := install()
			if preview["status"] != "planned" || preview["planId"] == "" {
				t.Fatalf("not a preview: %v", preview)
			}
			args["planId"], args["apply"] = preview["planId"], true
			if got := install(); got["applied"] != true {
				t.Fatalf("not installed: %v", got)
			}
			items, warnings := pluginpkg.LoadInstalled(state)
			if len(warnings) != 0 || len(items) != 1 {
				t.Fatalf("inventory=%d warnings=%v", len(items), warnings)
			}
			client, err := sidecar.StartClient(t.Context(), sidecar.ClientOptions{
				Package: items[0].Package, Installed: items[0].Installed,
				Session: protocol.SessionContext{SessionID: "native-package-test", WorkspaceRoot: workspace, Generation: 1},
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = client.Close() })
			call := func(args map[string]any) map[string]any {
				raw, _ := json.Marshal(args)
				result, err := client.CallTool(t.Context(), spec.tool, raw, 10*time.Second)
				if err != nil || result.IsError {
					t.Fatalf("call: %v %s", err, result.Content)
				}
				var body map[string]any
				if err := json.Unmarshal([]byte(result.Content), &body); err != nil {
					t.Fatal(err)
				}
				return body
			}
			start := call(map[string]any{"action": "start", "task": "installed host result"})
			result := call(map[string]any{"action": "status", "job_id": start["job_id"], "wait_seconds": 5})
			if result["status"] != "completed" || result["answer"] != "installed host result" {
				t.Fatalf("wrong result: %v", result)
			}
			if err := os.WriteFile(filepath.Join(workspace, "answer.mjs"), []byte("export const answer = 0;\n"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(workspace, "answer.test.mjs"), []byte("import {answer} from './answer.mjs'; if(answer!==42) throw Error('wrong answer');\n"), 0600); err != nil {
				t.Fatal(err)
			}
			edit := call(map[string]any{"action": "start", "task": "edit-fixture"})
			result = call(map[string]any{"action": "status", "job_id": edit["job_id"], "wait_seconds": 5})
			if result["status"] != "completed" {
				t.Fatalf("edit failed: %v", result)
			}
			content, err := os.ReadFile(filepath.Join(workspace, "answer.mjs"))
			if err != nil || string(content) != "export const answer = 42;\n" {
				t.Fatalf("edit missing: %s %v", content, err)
			}
			hang := call(map[string]any{"action": "start", "task": "detached-descendant"})
			deadline := time.Now().Add(5 * time.Second)
			for {
				if _, err := os.Stat(filepath.Join(workspace, "descendant.pid")); err == nil {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("native descendant did not start")
				}
				time.Sleep(25 * time.Millisecond)
			}
			if result := call(map[string]any{"action": "cancel", "job_id": hang["job_id"]}); result["status"] != "cancelled" {
				t.Fatalf("cancel failed: %v", result)
			}
			if err := client.Close(); err != nil {
				t.Fatal(err)
			}
			if err := pluginpkg.SetEnabled(state, spec.name, false); err != nil {
				t.Fatal(err)
			}
			items, warnings = pluginpkg.LoadInstalled(state)
			if len(warnings) != 0 || len(items) != 0 {
				t.Fatalf("disable did not persist: %v", warnings)
			}
			if err := pluginpkg.SetEnabled(state, spec.name, true); err != nil {
				t.Fatal(err)
			}
			items, warnings = pluginpkg.LoadInstalled(state)
			if len(warnings) != 0 || len(items) != 1 {
				t.Fatalf("enable did not restore inventory: %v", warnings)
			}
			if runtime.GOOS == "windows" {
				// Windows can signal process termination before image-section
				// teardown releases the executable. Assert that release explicitly
				// before testing uninstall, without retrying a destructive operation.
				binary := filepath.Join(items[0].Package.Root, "runtime", "launch.exe")
				deadline := time.Now().Add(3 * time.Second)
				for {
					file, err := os.OpenFile(binary, os.O_RDWR, 0)
					if err == nil {
						file.Close()
						break
					}
					if time.Now().After(deadline) {
						t.Fatalf("runtime executable remained locked after shutdown: %v", err)
					}
					time.Sleep(10 * time.Millisecond)
				}
			}
			args = map[string]any{"op": "uninstall", "name": spec.name}
			install()
			items, warnings = pluginpkg.LoadInstalled(state)
			if len(warnings) != 0 || len(items) != 0 {
				t.Fatalf("remove left inventory: %v", warnings)
			}
			t.Log("Preview, copied install, real host handshake, task, edit, result, cancel, disable, enable and removal passed (simulated native CLI)")
		})
	}
}
