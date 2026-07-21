// Package theme holds guardrails for the web UI's design tokens.
//
// It contains no runtime code — its purpose is the contrast regression test
// (contrast_test.go), which parses web/src/index.css and fails the build if any
// text color token drops below its WCAG 2.2 AA contrast floor in either theme.
package theme
