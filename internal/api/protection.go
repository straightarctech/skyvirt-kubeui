package api

import (
	"encoding/json"
	"net/http"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// ProtectionHandler serves resource protection REST endpoints.
type ProtectionHandler struct {
	kc *k8s.Client
}

func protectionHandler(kc *k8s.Client) *ProtectionHandler {
	return &ProtectionHandler{kc: kc}
}

type protectRequest struct {
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Protected bool   `json:"protected"`
}

// Set toggles protection on a resource.
// PUT /api/v1/protect
func (h *ProtectionHandler) Set(w http.ResponseWriter, r *http.Request) {
	var req protectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.Kind == "" || req.Name == "" {
		writeError(w, http.StatusBadRequest, "kind and name are required")
		return
	}

	gvr, namespaced, err := h.kc.ResolveKindToGVR(req.Kind)
	if err != nil {
		writeError(w, http.StatusBadRequest, "unknown kind: "+err.Error())
		return
	}

	ns := req.Namespace
	if !namespaced {
		ns = ""
	}

	if req.Protected {
		err = h.kc.SetResourceAnnotation(r.Context(), gvr, ns, req.Name, k8s.ProtectionAnnotation, "true")
	} else {
		err = h.kc.RemoveResourceAnnotation(r.Context(), gvr, ns, req.Name, k8s.ProtectionAnnotation)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"protected": req.Protected})
}

// Get checks protection status on a resource.
// GET /api/v1/protect?kind=Deployment&namespace=default&name=nginx
func (h *ProtectionHandler) Get(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	namespace := r.URL.Query().Get("namespace")
	name := r.URL.Query().Get("name")

	if kind == "" || name == "" {
		writeError(w, http.StatusBadRequest, "kind and name query params are required")
		return
	}

	gvr, namespaced, err := h.kc.ResolveKindToGVR(kind)
	if err != nil {
		writeError(w, http.StatusBadRequest, "unknown kind: "+err.Error())
		return
	}

	ns := namespace
	if !namespaced {
		ns = ""
	}

	protected, err := h.kc.IsResourceProtected(r.Context(), gvr, ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"protected": protected})
}

// checkProtection is a helper for delete handlers. It returns true if the
// resource is protected (and writes a 403 response), meaning the caller should
// return immediately.
func checkProtection(w http.ResponseWriter, r *http.Request, kc *k8s.Client, gvr schema.GroupVersionResource, namespace, name string) bool {
	protected, err := kc.IsResourceProtected(r.Context(), gvr, namespace, name)
	if err != nil {
		// Fail closed: if protection can't be verified, refuse the delete
		// rather than risk destroying a protected resource.
		writeError(w, http.StatusServiceUnavailable, "could not verify resource protection; delete refused")
		return true
	}
	if protected {
		writeError(w, http.StatusForbidden, "resource is protected — unprotect before deleting")
		return true
	}
	return false
}

// checkProtectionByKind resolves the kind to a GVR and checks protection.
// Returns true if the resource is protected (caller should return).
func checkProtectionByKind(w http.ResponseWriter, r *http.Request, kc *k8s.Client, kind, namespace, name string) bool {
	gvr, _, err := kc.ResolveKindToGVR(kind)
	if err != nil {
		return false
	}
	return checkProtection(w, r, kc, gvr, namespace, name)
}
