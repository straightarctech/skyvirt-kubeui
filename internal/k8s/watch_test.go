package k8s

import (
	"errors"
	"fmt"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// An absent optional operator (MetalLB, Multus…) must be classifiable as
// "not installed" rather than a generic failure — the API turns it into a 404
// and the UI stops reconnecting to a watch that can never succeed.
func TestIsKindNotInstalled(t *testing.T) {
	noMatch := &meta.NoKindMatchError{
		GroupKind:        schema.GroupKind{Group: "metallb.io", Kind: "IPAddressPool"},
		SearchedVersions: []string{"v1beta1"},
	}
	notFound := apierrors.NewNotFound(
		schema.GroupResource{Group: "k8s.cni.cncf.io", Resource: "network-attachment-definitions"}, "")

	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"sentinel", ErrKindNotInstalled, true},
		{"wrapped sentinel", fmt.Errorf("resolving GVR: %w: boom", ErrKindNotInstalled), true},
		{"rest-mapper no match", noMatch, true},
		{"wrapped no match", fmt.Errorf("resolving GVR: %w", noMatch), true},
		{"apiserver 404", notFound, true},
		{"wrapped 404", fmt.Errorf("listing: %w", notFound), true},
		{"forbidden", apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "p", errors.New("nope")), false},
		{"unrelated", errors.New("connection refused"), false},
		{"internal server error", apierrors.NewInternalError(errors.New("boom")), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsKindNotInstalled(tt.err); got != tt.want {
				t.Fatalf("IsKindNotInstalled(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}

	// Guard the shape the dynamic client actually returns for an unknown GVR:
	// a bare Status 404 with no details.
	bare := &apierrors.StatusError{ErrStatus: metav1.Status{
		Code:   404,
		Reason: metav1.StatusReasonNotFound,
		Status: metav1.StatusFailure,
	}}
	if !IsKindNotInstalled(fmt.Errorf("listing CRD instances: %w", bare)) {
		t.Fatal("bare 404 status should classify as not-installed")
	}
}
