package sidecar_test

import (
	"encoding/json"
	"os"
	"path/filepath"
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
			args = map[string]any{"op": "uninstall", "name": spec.name}
			install()
			items, warnings = pluginpkg.LoadInstalled(state)
			if len(warnings) != 0 || len(items) != 0 {
				t.Fatalf("remove left inventory: %v", warnings)
			}
			t.Log("Preview, copied install, real host handshake, task, result, disable, enable and removal passed")
		})
	}
}
