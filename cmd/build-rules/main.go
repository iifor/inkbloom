// Command build-rules bundles the shared gameplay rules for the Go process.
package main

import (
	"github.com/evanw/esbuild/pkg/api"
	"os"
)

func main() {
	result := api.Build(api.BuildOptions{EntryPoints: []string{"internal/multiplayer/rules.ts"}, Bundle: true, Write: true, Outfile: "internal/multiplayer/rules.js", Format: api.FormatIIFE, GlobalName: "Rules", Target: api.ES2017, LogLevel: api.LogLevelWarning})
	if len(result.Errors) > 0 {
		os.Exit(1)
	}
}
