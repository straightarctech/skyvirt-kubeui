package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// StorageHandler serves PV, PVC, and StorageClass REST endpoints.
type StorageHandler struct {
	kc *k8s.Client
}

func storageHandler(kc *k8s.Client) *StorageHandler {
	return &StorageHandler{kc: kc}
}

// ListPVs returns all PersistentVolumes.
func (h *StorageHandler) ListPVs(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListPVs(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListPVCs returns PersistentVolumeClaims across all namespaces.
func (h *StorageHandler) ListPVCs(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListPVCs(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListPVCsNamespaced returns PersistentVolumeClaims in a specific namespace.
func (h *StorageHandler) ListPVCsNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListPVCs(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// DeletePVC removes a PersistentVolumeClaim.
func (h *StorageHandler) DeletePVC(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "PersistentVolumeClaim", ns, name) {
		return
	}
	if err := h.kc.DeletePVC(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// CreatePV creates a new PersistentVolume.
// Expects JSON body: {"name", "capacity", "access_modes", "storage_class", "reclaim_policy", "host_path"/"nfs"}.
func (h *StorageHandler) CreatePV(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name          string   `json:"name"`
		Capacity      string   `json:"capacity"`
		AccessModes   []string `json:"access_modes"`
		StorageClass  string   `json:"storage_class"`
		ReclaimPolicy string   `json:"reclaim_policy"`
		HostPath      string   `json:"host_path"`
		NFSServer     string   `json:"nfs_server"`
		NFSPath       string   `json:"nfs_path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if body.Name == "" || body.Capacity == "" {
		writeError(w, http.StatusBadRequest, "name and capacity are required")
		return
	}
	capQty, err := resource.ParseQuantity(body.Capacity)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid capacity: "+err.Error())
		return
	}
	if body.HostPath == "" && body.NFSServer == "" {
		writeError(w, http.StatusBadRequest, "either host_path or nfs_server+nfs_path is required")
		return
	}

	modes := make([]corev1.PersistentVolumeAccessMode, len(body.AccessModes))
	for i, m := range body.AccessModes {
		modes[i] = corev1.PersistentVolumeAccessMode(m)
	}
	if len(modes) == 0 {
		modes = []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce}
	}

	reclaimPolicy := corev1.PersistentVolumeReclaimRetain
	if body.ReclaimPolicy != "" {
		reclaimPolicy = corev1.PersistentVolumeReclaimPolicy(body.ReclaimPolicy)
	}

	pv := &corev1.PersistentVolume{
		ObjectMeta: metav1.ObjectMeta{Name: body.Name},
		Spec: corev1.PersistentVolumeSpec{
			Capacity: corev1.ResourceList{
				corev1.ResourceStorage: capQty,
			},
			AccessModes:                   modes,
			StorageClassName:              body.StorageClass,
			PersistentVolumeReclaimPolicy: reclaimPolicy,
		},
	}

	if body.NFSServer != "" {
		pv.Spec.PersistentVolumeSource = corev1.PersistentVolumeSource{
			NFS: &corev1.NFSVolumeSource{
				Server: body.NFSServer,
				Path:   body.NFSPath,
			},
		}
	} else {
		pv.Spec.PersistentVolumeSource = corev1.PersistentVolumeSource{
			HostPath: &corev1.HostPathVolumeSource{
				Path: body.HostPath,
			},
		}
	}

	if err := h.kc.CreatePV(r.Context(), pv); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

// DeletePV removes a PersistentVolume.
func (h *StorageHandler) DeletePV(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "PersistentVolume", "", name) {
		return
	}
	if err := h.kc.DeletePV(r.Context(), name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// CreatePVC creates a new PersistentVolumeClaim.
// Expects JSON body: {"name", "capacity", "access_modes", "storage_class"}.
func (h *StorageHandler) CreatePVC(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	var body struct {
		Name         string   `json:"name"`
		Capacity     string   `json:"capacity"`
		AccessModes  []string `json:"access_modes"`
		StorageClass string   `json:"storage_class"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if body.Name == "" || body.Capacity == "" {
		writeError(w, http.StatusBadRequest, "name and capacity are required")
		return
	}
	capQty, err := resource.ParseQuantity(body.Capacity)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid capacity: "+err.Error())
		return
	}

	modes := make([]corev1.PersistentVolumeAccessMode, len(body.AccessModes))
	for i, m := range body.AccessModes {
		modes[i] = corev1.PersistentVolumeAccessMode(m)
	}
	if len(modes) == 0 {
		modes = []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce}
	}

	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      body.Name,
			Namespace: ns,
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: modes,
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceStorage: capQty,
				},
			},
		},
	}
	if body.StorageClass != "" {
		pvc.Spec.StorageClassName = &body.StorageClass
	}

	if err := h.kc.CreatePVC(r.Context(), pvc); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

// ListStorageClasses returns all StorageClasses.
func (h *StorageHandler) ListStorageClasses(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListStorageClasses(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListPVCsWithUsage returns PVCs enriched with filesystem usage from kubelet stats.
func (h *StorageHandler) ListPVCsWithUsage(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListPVCsWithUsage(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListPVCsWithUsageNamespaced returns PVCs with usage in a specific namespace.
func (h *StorageHandler) ListPVCsWithUsageNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListPVCsWithUsage(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ResizePVC expands a PVC to a new capacity.
func (h *StorageHandler) ResizePVC(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	var body struct {
		Capacity string `json:"capacity"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if body.Capacity == "" {
		writeError(w, http.StatusBadRequest, "capacity is required")
		return
	}

	if err := h.kc.ResizePVC(r.Context(), ns, name, body.Capacity); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "resized", "new_capacity": body.Capacity})
}
