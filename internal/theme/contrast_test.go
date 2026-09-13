package theme

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestTokenContrast enforces WCAG 2.2 AA on the UI's text color tokens in BOTH
// themes. It is the guard that keeps a regression like the one fixed in the
// accessibility audit (--th-ghost at 2.56:1 light / 3.06:1 dark) from ever
// shipping again.
//
// For each theme it parses the token block in web/src/index.css, then checks
// every text token against every background surface it can be rendered on. A
// text token must clear 4.5:1 (normal text) on all of them.
func TestTokenContrast(t *testing.T) {
	const aaNormal = 4.5

	light, dark := parseThemes(t)

	// Text tokens that render actual content (not hairlines/disabled glyphs).
	// --th-faint is decorative only (borders, disabled) and is never used for
	// text, so it is intentionally excluded.
	textTokens := []string{"heading", "body", "label", "dim", "ghost"}

	// Backgrounds a text token may sit on. The darkest of these (light theme)
	// or lightest (dark theme) is the worst case, so we test against all.
	bgTokens := []string{"page", "panel", "panel-alt", "subtle", "hover"}

	for _, tc := range []struct {
		name   string
		tokens map[string]string
	}{
		{"light", light},
		{"dark", dark},
	} {
		for _, tk := range textTokens {
			fg, ok := tc.tokens["th-"+tk]
			if !ok {
				t.Errorf("[%s] missing text token --th-%s", tc.name, tk)
				continue
			}
			for _, bk := range bgTokens {
				bg, ok := tc.tokens["th-"+bk]
				if !ok {
					continue
				}
				r := contrast(fg, bg)
				if r < aaNormal {
					t.Errorf("[%s] --th-%s (%s) on --th-%s (%s) = %.2f:1, below AA %.1f:1",
						tc.name, tk, fg, bk, bg, r, aaNormal)
				}
			}
		}
	}
}

var tokenRe = regexp.MustCompile(`^\s*--(th-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;`)

// parseThemes returns the light (:root) and dark (.dark) hex token maps from
// web/src/index.css. Only #rrggbb tokens are captured (rgba()/var() are skipped).
func parseThemes(t *testing.T) (light, dark map[string]string) {
	t.Helper()
	// Test CWD is this package dir; index.css lives at repo web/src/index.css.
	path := filepath.Join("..", "..", "web", "src", "index.css")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	light, dark = map[string]string{}, map[string]string{}
	var cur map[string]string
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, ":root {"):
			cur = light
		case strings.HasPrefix(trimmed, ".dark {"):
			cur = dark
		case trimmed == "}":
			cur = nil
		default:
			if cur != nil {
				if m := tokenRe.FindStringSubmatch(line); m != nil {
					cur[m[1]] = m[2]
				}
			}
		}
	}
	if len(light) == 0 || len(dark) == 0 {
		t.Fatalf("parsed no tokens (light=%d dark=%d) from %s", len(light), len(dark), path)
	}
	return light, dark
}

// contrast returns the WCAG 2.x contrast ratio between two #rrggbb colors.
func contrast(a, b string) float64 {
	la, lb := relLuminance(a), relLuminance(b)
	hi, lo := math.Max(la, lb), math.Min(la, lb)
	return (hi + 0.05) / (lo + 0.05)
}

func relLuminance(hex string) float64 {
	r, g, b := hexChannels(hex)
	return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b)
}

func lin(c float64) float64 {
	if c <= 0.03928 {
		return c / 12.92
	}
	return math.Pow((c+0.055)/1.055, 2.4)
}

func hexChannels(hex string) (r, g, b float64) {
	hex = strings.TrimPrefix(hex, "#")
	var ri, gi, bi int
	fmt.Sscanf(hex, "%02x%02x%02x", &ri, &gi, &bi)
	return float64(ri) / 255, float64(gi) / 255, float64(bi) / 255
}
