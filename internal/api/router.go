package api

import (
	"context"
	"io/fs"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"go.uber.org/zap"

	"github.com/straightarctech/skyvirt-kubeui/internal/ai"
	"github.com/straightarctech/skyvirt-kubeui/internal/audit"
	"github.com/straightarctech/skyvirt-kubeui/internal/auth"
	"github.com/straightarctech/skyvirt-kubeui/internal/db"
	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// NewRouter builds the top-level HTTP handler with all API routes and the SPA
// fallback for the embedded web front-end.
func NewRouter(kc *k8s.Client, pgDB *db.PostgresDB, auditStore audit.Store, webFS fs.FS, logger *zap.Logger, engineURL string, authCfg auth.Config, authzCfg AuthzConfig, aiCfg ai.Config) http.Handler {
	r := chi.NewRouter()

	// Global middleware
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(RequestLogger(logger))
	r.Use(chimiddleware.Recoverer)
	r.Use(CORSMiddleware)

	// Engine proxy client (auth only — VMs are managed by the main SkyVirtHCI portal).
	var engine *EngineClient
	var authProxy *AuthProxyHandler
	if engineURL != "" {
		engine = NewEngineClient(engineURL, logger)
		authProxy = newAuthProxyHandler(engine)
	}

	// Instantiate handlers once so they are reused across requests.
	nodes := nodesHandler(kc)
	pods := podsHandler(kc)
	deps := deploymentsHandler(kc)
	sts := statefulSetsHandler(kc)
	ds := daemonSetsHandler(kc)
	svcs := servicesHandler(kc)
	ns := namespacesHandler(kc)
	ev := eventsHandler(kc)
	met := metricsHandler(kc)
	cm := configMapsHandler(kc)
	sec := secretsHandler(kc)
	ing := ingressHandler(kc)
	rb := rbacHandler(kc)
	stor := storageHandler(kc)
	net := networkHandler(kc)
	hp := hpaHandler(kc)
	jb := jobsHandler(kc)
	crd := crdsHandler(kc)
	hlm := helmHandler(kc)
	vel := veleroHandler(kc)
	upg := upgradeHandler(kc)
	certs := certsHandler(kc)
	arh := accessReviewHandler(kc)
	ex := execHandler(kc)
	wat := watchHandler(kc)
	aiClient := ai.New(aiCfg)
	aiv := aiValuesHandler(aiClient)
	git := gitopsHandler(kc)
	vuln := vulnHandler(kc)
	fwd := forwardHandler(kc, logger)
	go fwd.RunScheduler(context.Background())
	diag := diagnoseHandler(kc, aiClient)
	sa := serviceAccountsHandler(kc)
	rq := resourceQuotasHandler(kc)
	pdb := pdbsHandler(kc)
	pc := priorityClassesHandler(kc)
	wh := webhooksHandler(kc)
	ep := endpointsHandler(kc)
	lr := limitRangesHandler(kc)
	ap := applyHandler(kc)
	prot := protectionHandler(kc)

	// Public auth routes (no JWT required).
	if authProxy != nil {
		r.Post("/api/v1/auth/login", authProxy.Login)
		r.Post("/api/v1/auth/refresh", authProxy.Refresh)
	}

	// Auth config endpoint (public, tells frontend if auth is required).
	r.Get("/api/v1/auth/config", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{
			"auth_enabled": authCfg.Enabled,
			"ai_enabled":   aiCfg.Enabled(),
		})
	})

	// API routes
	r.Route("/api/v1", func(api chi.Router) {
		// Apply auth middleware to all API routes.
		api.Use(auth.Middleware(authCfg))
		// Record mutating actions (before authz, so denials are audited too).
		api.Use(AuditRecorder(auditStore))
		// Enforce read-only mode and role-based write access.
		api.Use(AuthzMiddleware(authzCfg))

		// Auth (protected)
		if authProxy != nil {
			api.Get("/auth/me", authProxy.Me)
		}

		// --- Audit log ---
		api.Get("/audit", auditHandler(auditStore))

		// --- Security posture ---
		api.Get("/security/posture", securityPostureHandler(kc))

		// --- Nodes ---
		api.Get("/nodes", nodes.List)
		api.Get("/nodes/{name}", nodes.Get)
		api.Post("/nodes/{name}/cordon", nodes.Cordon)
		api.Post("/nodes/{name}/uncordon", nodes.Uncordon)
		api.Post("/nodes/{name}/drain", nodes.Drain)
		api.Put("/nodes/{name}/labels", nodes.SetLabels)
		api.Post("/nodes/{name}/taint", nodes.AddTaint)
		api.Delete("/nodes/{name}/taint/{key}", nodes.RemoveTaint)

		// --- Pods ---
		api.Get("/pods", pods.List)
		api.Get("/namespaces/{namespace}/pods", pods.ListNamespaced)
		api.Get("/namespaces/{namespace}/pods/{name}", pods.Get)
		api.Delete("/namespaces/{namespace}/pods/{name}", pods.Delete)
		api.Get("/namespaces/{namespace}/pods/{name}/logs", pods.Logs)

		// --- Deployments ---
		api.Get("/deployments", deps.List)
		api.Get("/namespaces/{namespace}/deployments", deps.ListNamespaced)
		api.Get("/namespaces/{namespace}/deployments/{name}", deps.Get)
		api.Post("/namespaces/{namespace}/deployments/{name}/scale", deps.Scale)
		api.Post("/namespaces/{namespace}/deployments/{name}/restart", deps.Restart)
		api.Post("/namespaces/{namespace}/deployments/{name}/rollback", deps.Rollback)
		api.Delete("/namespaces/{namespace}/deployments/{name}", deps.Delete)
		api.Get("/namespaces/{namespace}/deployments/{name}/replicasets", deps.ListReplicaSets)

		// --- StatefulSets ---
		api.Get("/statefulsets", sts.List)
		api.Get("/namespaces/{namespace}/statefulsets", sts.ListNamespaced)
		api.Post("/namespaces/{namespace}/statefulsets/{name}/scale", sts.Scale)
		api.Post("/namespaces/{namespace}/statefulsets/{name}/restart", sts.Restart)
		api.Delete("/namespaces/{namespace}/statefulsets/{name}", sts.Delete)

		// --- DaemonSets ---
		api.Get("/daemonsets", ds.List)
		api.Get("/namespaces/{namespace}/daemonsets", ds.ListNamespaced)
		api.Post("/namespaces/{namespace}/daemonsets/{name}/restart", ds.Restart)
		api.Delete("/namespaces/{namespace}/daemonsets/{name}", ds.Delete)

		// --- Services ---
		api.Get("/services", svcs.List)
		api.Get("/namespaces/{namespace}/services", svcs.ListNamespaced)
		api.Get("/namespaces/{namespace}/services/{name}", svcs.Get)
		api.Post("/namespaces/{namespace}/services", svcs.Create)
		api.Delete("/namespaces/{namespace}/services/{name}", svcs.Delete)

		// --- Namespaces ---
		api.Get("/namespaces", ns.List)
		api.Post("/namespaces", ns.Create)
		api.Delete("/namespaces/{name}", ns.Delete)
		api.Get("/namespaces/{name}/resources", ns.Resources)

		// --- Events ---
		api.Get("/events", ev.List)
		api.Get("/namespaces/{namespace}/events", ev.ListNamespaced)

		// --- Metrics ---
		api.Get("/metrics/nodes", met.TopNodes)
		api.Get("/metrics/pods", met.TopPods)
		api.Get("/namespaces/{namespace}/metrics/pods", met.TopPodsNamespaced)

		// --- ConfigMaps ---
		api.Get("/configmaps", cm.List)
		api.Get("/namespaces/{namespace}/configmaps", cm.ListNamespaced)
		api.Get("/namespaces/{namespace}/configmaps/{name}", cm.Get)
		api.Post("/namespaces/{namespace}/configmaps", cm.Create)
		api.Put("/namespaces/{namespace}/configmaps/{name}", cm.Update)
		api.Delete("/namespaces/{namespace}/configmaps/{name}", cm.Delete)

		// --- Secrets ---
		api.Get("/secrets", sec.List)
		api.Get("/namespaces/{namespace}/secrets", sec.ListNamespaced)
		api.Get("/namespaces/{namespace}/secrets/{name}", sec.Get)
		api.Post("/namespaces/{namespace}/secrets", sec.Create)
		api.Put("/namespaces/{namespace}/secrets/{name}", sec.Update)
		api.Delete("/namespaces/{namespace}/secrets/{name}", sec.Delete)

		// --- Ingresses ---
		api.Get("/ingresses", ing.List)
		api.Get("/namespaces/{namespace}/ingresses", ing.ListNamespaced)
		api.Get("/namespaces/{namespace}/ingresses/{name}", ing.Get)
		api.Delete("/namespaces/{namespace}/ingresses/{name}", ing.Delete)

		// --- RBAC ---
		api.Get("/clusterroles", rb.ListClusterRoles)
		api.Get("/namespaces/{namespace}/roles", rb.ListRoles)
		api.Get("/clusterrolebindings", rb.ListClusterRoleBindings)
		api.Get("/namespaces/{namespace}/rolebindings", rb.ListRoleBindings)

		// --- Storage ---
		api.Get("/pvs", stor.ListPVs)
		api.Post("/pvs", stor.CreatePV)
		api.Delete("/pvs/{name}", stor.DeletePV)
		api.Get("/pvcs", stor.ListPVCsWithUsage)
		api.Get("/namespaces/{namespace}/pvcs", stor.ListPVCsWithUsageNamespaced)
		api.Post("/namespaces/{namespace}/pvcs", stor.CreatePVC)
		api.Patch("/namespaces/{namespace}/pvcs/{name}/resize", stor.ResizePVC)
		api.Delete("/namespaces/{namespace}/pvcs/{name}", stor.DeletePVC)
		api.Get("/storageclasses", stor.ListStorageClasses)

		// --- NetworkPolicies ---
		api.Get("/networkpolicies", net.List)
		api.Get("/namespaces/{namespace}/networkpolicies", net.ListNamespaced)
		api.Get("/namespaces/{namespace}/networkpolicies/{name}", net.Get)
		api.Delete("/namespaces/{namespace}/networkpolicies/{name}", net.Delete)

		// --- HPAs ---
		api.Get("/hpas", hp.List)
		api.Get("/namespaces/{namespace}/hpas", hp.ListNamespaced)
		api.Delete("/namespaces/{namespace}/hpas/{name}", hp.Delete)

		// --- Jobs / CronJobs ---
		api.Get("/jobs", jb.ListJobs)
		api.Get("/namespaces/{namespace}/jobs", jb.ListJobsNamespaced)
		api.Delete("/namespaces/{namespace}/jobs/{name}", jb.DeleteJob)
		api.Get("/cronjobs", jb.ListCronJobs)
		api.Get("/namespaces/{namespace}/cronjobs", jb.ListCronJobsNamespaced)
		api.Delete("/namespaces/{namespace}/cronjobs/{name}", jb.DeleteCronJob)
		api.Put("/namespaces/{namespace}/cronjobs/{name}/suspend", jb.SuspendCronJob)

		// --- CRDs ---
		api.Get("/crds", crd.List)
		api.Get("/crds/{group}/{version}/{resource}", crd.ListInstances)
		api.Get("/namespaces/{namespace}/crds/{group}/{version}/{resource}", crd.ListInstancesNamespaced)

		// --- Helm ---
		api.Get("/helm/releases", hlm.List)
		api.Post("/helm/install", hlm.Install)
		api.Get("/helm/search", hlm.SearchRepo)
		api.Get("/namespaces/{namespace}/helm/releases", hlm.ListNamespaced)
		api.Get("/namespaces/{namespace}/helm/releases/{name}", hlm.Get)
		api.Put("/namespaces/{namespace}/helm/releases/{name}", hlm.Upgrade)
		api.Delete("/namespaces/{namespace}/helm/releases/{name}", hlm.Uninstall)
		api.Post("/namespaces/{namespace}/helm/releases/{name}/rollback", hlm.Rollback)
		api.Get("/namespaces/{namespace}/helm/releases/{name}/values", hlm.GetValues)
		api.Get("/namespaces/{namespace}/helm/releases/{name}/manifest", hlm.GetManifest)
		api.Get("/namespaces/{namespace}/helm/releases/{name}/notes", hlm.GetNotes)
		api.Get("/namespaces/{namespace}/helm/releases/{name}/history", hlm.History)

		api.Get("/upgrade/api-scan", upg.APIScan)
		api.Get("/certs/expiry", certs.Expiry)
		api.Post("/rbac/access-review", arh.Check)
		api.Get("/rbac/risky-bindings", arh.Risky)

		// --- Backup / DR (Velero) ---
		api.Get("/velero/status", vel.Status)
		api.Get("/velero/{resource}", vel.List)
		api.Post("/velero/backups", vel.CreateBackup)
		api.Post("/velero/schedules", vel.CreateSchedule)
		api.Post("/velero/restores", vel.CreateRestore)
		api.Delete("/velero/{resource}/{name}", vel.Delete)

		// --- App Catalog (Helm repos + chart browse) ---
		api.Get("/helm/repos", hlm.RepoList)
		api.Post("/helm/repos", hlm.RepoAdd)
		api.Delete("/helm/repos/{name}", hlm.RepoRemove)
		api.Get("/catalog/charts", hlm.CatalogSearch)
		api.Get("/catalog/chart", hlm.ChartShow)
		api.Post("/catalog/ai-values", aiv.HelmValues)
		api.Post("/gitops/fetch", git.Fetch)
		api.Get("/vuln/status", vuln.Status)
		api.Get("/vuln/reports", vuln.Reports)
		api.Post("/forward/security", fwd.Security)
		api.Get("/forward/config", fwd.GetConfig)
		api.Put("/forward/config", fwd.PutConfig)

		// --- ServiceAccounts ---
		api.Get("/serviceaccounts", sa.List)
		api.Get("/namespaces/{namespace}/serviceaccounts", sa.ListNamespaced)
		api.Delete("/namespaces/{namespace}/serviceaccounts/{name}", sa.Delete)

		// --- ResourceQuotas ---
		api.Get("/resourcequotas", rq.List)
		api.Get("/namespaces/{namespace}/resourcequotas", rq.ListNamespaced)
		api.Delete("/namespaces/{namespace}/resourcequotas/{name}", rq.Delete)

		// --- PodDisruptionBudgets ---
		api.Get("/pdbs", pdb.List)
		api.Get("/namespaces/{namespace}/pdbs", pdb.ListNamespaced)
		api.Delete("/namespaces/{namespace}/pdbs/{name}", pdb.Delete)

		// --- PriorityClasses ---
		api.Get("/priorityclasses", pc.List)
		api.Delete("/priorityclasses/{name}", pc.Delete)

		// --- Webhooks ---
		api.Get("/webhooks/validating", wh.ListValidating)
		api.Get("/webhooks/mutating", wh.ListMutating)
		api.Delete("/webhooks/validating/{name}", wh.DeleteValidating)
		api.Delete("/webhooks/mutating/{name}", wh.DeleteMutating)

		// --- Endpoints ---
		api.Get("/endpoints", ep.List)
		api.Get("/namespaces/{namespace}/endpoints", ep.ListNamespaced)

		// --- LimitRanges ---
		api.Get("/limitranges", lr.List)
		api.Get("/namespaces/{namespace}/limitranges", lr.ListNamespaced)

		// --- Resource Protection ---
		api.Put("/protect", prot.Set)
		api.Get("/protect", prot.Get)

		// --- Generic Apply ---
		api.Post("/apply", ap.Apply)
		api.Get("/resources/{kind}/namespaces/{namespace}/{name}", ap.GetResource)
		api.Put("/resources/{kind}/namespaces/{namespace}/{name}", ap.UpdateResource)
		api.Delete("/resources/{kind}/namespaces/{namespace}/{name}", ap.DeleteResource)
		api.Get("/resources/{kind}/{name}", ap.GetClusterResource)
		api.Put("/resources/{kind}/{name}", ap.UpdateClusterResource)
		api.Delete("/resources/{kind}/{name}", ap.DeleteClusterResource)

		// --- Pod exec (WebSocket) ---
		api.Get("/namespaces/{namespace}/pods/{name}/exec", ex.Exec)

		// --- Real-time watch (WebSocket) ---
		api.Get("/watch", wat.Watch)

		// --- One-click diagnostics (+ optional AI explain) ---
		api.Get("/diagnose/pod/{namespace}/{name}", diag.DiagnosePod)
		api.Get("/diagnose/workload/{kind}/{namespace}/{name}", diag.DiagnoseWorkload)
		api.Post("/diagnose/explain", diag.ExplainFinding)
	})

	// SPA fallback -- serve index.html for non-API routes.
	fileServer := http.FileServer(http.FS(webFS))
	r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
		path := strings.TrimPrefix(req.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		// Try serving the file directly first.
		if f, err := webFS.Open(path); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, req)
			return
		}
		// SPA fallback -- serve index.html for client-side routing.
		req.URL.Path = "/"
		fileServer.ServeHTTP(w, req)
	})

	return r
}
