package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/audit"
	"github.com/straightarctech/skyvirt-kubeui/internal/auth"
)

// maxAuditBody caps how much of a request body the recorder buffers to recover
// a target name. Larger or streaming bodies are passed through untouched (the
// name simply stays unset, as before).
const maxAuditBody = 1 << 20 // 1 MiB

// AuditRecorder records every mutating request (create/update/delete/scale/…)
// after it runs, capturing the user, target resource, and result status —
// including denied (403) and failed attempts, which is what makes it useful for
// security review. Reads are ignored. Must run after auth.Middleware so the user
// is in context; placing it before AuthzMiddleware lets it also see denials.
func AuditRecorder(store audit.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !isMutating(r) || strings.Contains(r.URL.Path, "/auth/") {
				next.ServeHTTP(w, r)
				return
			}
			// Buffer a small JSON body so we can recover the target name for
			// create requests, where the name lives in the payload rather than
			// the URL. The body is restored for the handler; oversized or
			// streaming bodies are skipped (no truncation, no name — as before).
			var bodyBuf []byte
			if r.Body != nil && jsonRequest(r) && r.ContentLength > 0 && r.ContentLength <= maxAuditBody {
				bodyBuf, _ = io.ReadAll(r.Body)
				r.Body = io.NopCloser(bytes.NewReader(bodyBuf))
			}

			ww := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(ww, r)

			action, kind, ns, name, resource := parseAuditTarget(r)
			if name == "" {
				if n := nameFromBody(bodyBuf); n != "" {
					name = n
					resource = auditResource(kind, ns, name, r.URL.Path)
				}
			}
			claims := auth.UserFromContext(r.Context())
			e := audit.Entry{
				Action: action, Kind: kind, Namespace: ns, Name: name, Resource: resource,
				Method: r.Method, Path: r.URL.Path, Status: ww.status,
			}
			if claims != nil {
				e.User = claims.UserID
				e.Email = claims.Email
				e.Role = claims.Role
			}
			if e.User == "" {
				e.User = "system"
			}
			store.Record(e)
		})
	}
}

// parseAuditTarget derives (action, kind, namespace, name, resource-summary) from
// the matched chi route. It leans on the consistent route shape
// /api/v1/[namespaces/{namespace}/]{plural}/{name}[/{verb}].
func parseAuditTarget(r *http.Request) (action, kind, ns, name, resource string) {
	rctx := chi.RouteContext(r.Context())
	ns = rctx.URLParam("namespace")
	name = rctx.URLParam("name")

	// Split the route pattern into meaningful segments (drop /api/v1 and params).
	pattern := strings.TrimPrefix(rctx.RoutePattern(), "/api/v1/")
	segs := strings.Split(pattern, "/")
	var plural, verb string
	for i := 0; i < len(segs); i++ {
		s := segs[i]
		if s == "" || strings.HasPrefix(s, "{") {
			continue
		}
		// "namespaces" is the namespace *selector* only when followed by the
		// {namespace} param (e.g. /namespaces/{namespace}/pods). On /namespaces
		// and /namespaces/{name} it is the target resource itself.
		if s == "namespaces" && i+1 < len(segs) && segs[i+1] == "{namespace}" {
			continue
		}
		if plural == "" {
			plural = s // first concrete segment after optional namespaces/{ns}
		} else {
			verb = s // a concrete segment after {name} is a sub-action verb
		}
	}
	// The generic /resources/{kind}/… routes carry the real kind as a URL param.
	if k := rctx.URLParam("kind"); k != "" {
		kind = k
	} else {
		kind = singularKind(plural)
	}

	// Action: an explicit verb wins; otherwise derive from the HTTP method.
	switch verb {
	case "scale", "restart", "rollback", "cordon", "uncordon", "drain", "taint", "exec", "labels":
		action = verb
	default:
		switch r.Method {
		case http.MethodPost:
			action = "create"
		case http.MethodPut, http.MethodPatch:
			action = "update"
		case http.MethodDelete:
			action = "delete"
		default:
			action = strings.ToLower(r.Method)
		}
		// The generic apply endpoint has no name.
		if plural == "apply" || strings.HasSuffix(r.URL.Path, "/apply") {
			action, kind = "apply", "Manifest"
		}
	}

	resource = auditResource(kind, ns, name, r.URL.Path)
	return action, kind, ns, name, resource
}

// auditResource renders the human-readable target summary, e.g.
// "ConfigMap default/web", falling back to the request path when the kind is
// unknown.
func auditResource(kind, ns, name, path string) string {
	switch {
	case kind != "" && ns != "" && name != "":
		return kind + " " + ns + "/" + name
	case kind != "" && name != "":
		return kind + " " + name
	case kind != "":
		return kind
	default:
		return path
	}
}

// jsonRequest reports whether the body is (or is unlabelled and likely) JSON.
func jsonRequest(r *http.Request) bool {
	ct := r.Header.Get("Content-Type")
	return ct == "" || strings.Contains(ct, "json")
}

// nameFromBody recovers the target name from a create payload — typed creates
// carry a top-level "name"; raw manifests carry "metadata.name".
func nameFromBody(buf []byte) string {
	if len(buf) == 0 {
		return ""
	}
	var probe struct {
		Name     string `json:"name"`
		Metadata struct {
			Name string `json:"name"`
		} `json:"metadata"`
	}
	if json.Unmarshal(buf, &probe) != nil {
		return ""
	}
	if probe.Name != "" {
		return probe.Name
	}
	return probe.Metadata.Name
}

var kindByPlural = map[string]string{
	"pods": "Pod", "deployments": "Deployment", "statefulsets": "StatefulSet",
	"daemonsets": "DaemonSet", "jobs": "Job", "cronjobs": "CronJob", "services": "Service",
	"ingresses": "Ingress", "networkpolicies": "NetworkPolicy", "endpoints": "Endpoints",
	"configmaps": "ConfigMap", "secrets": "Secret", "serviceaccounts": "ServiceAccount",
	"namespaces": "Namespace", "nodes": "Node", "hpas": "HorizontalPodAutoscaler",
	"pvcs": "PersistentVolumeClaim", "pvs": "PersistentVolume", "storageclasses": "StorageClass",
	"priorityclasses": "PriorityClass", "resourcequotas": "ResourceQuota", "pdbs": "PodDisruptionBudget",
	"helm": "HelmRelease", "resources": "Resource",
}

func singularKind(plural string) string {
	if plural == "" {
		return ""
	}
	if k, ok := kindByPlural[plural]; ok {
		return k
	}
	// Fallback: strip a trailing "s" and title-case.
	s := strings.TrimSuffix(plural, "s")
	if s == "" {
		return ""
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// auditHandler serves the recorded entries, newest-first.
func auditHandler(store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := queryInt(r, "limit", 200)
		offset := queryInt(r, "offset", 0)
		if limit > 1000 {
			limit = 1000
		}
		entries, total := store.List(limit, offset)
		writeJSON(w, http.StatusOK, map[string]interface{}{"entries": entries, "total": total})
	}
}

func queryInt(r *http.Request, key string, def int) int {
	if v := r.URL.Query().Get(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
