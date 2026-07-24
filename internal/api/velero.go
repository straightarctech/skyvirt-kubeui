package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// VeleroHandler serves the Backup/DR (Velero) REST endpoints.
type VeleroHandler struct{ kc *k8s.Client }

func veleroHandler(kc *k8s.Client) *VeleroHandler { return &VeleroHandler{kc: kc} }

// Status reports whether Velero is installed and where it lives.
func (h *VeleroHandler) Status(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"installed": h.kc.VeleroInstalled(r.Context()),
		"namespace": k8s.VeleroNamespace,
	})
}

// List returns Velero objects for a resource kind.
func (h *VeleroHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListVelero(r.Context(), chi.URLParam(r, "resource"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

type veleroBackupRequest struct {
	Name            string   `json:"name"`
	Namespaces      []string `json:"namespaces"`
	TTLHours        int      `json:"ttl_hours"`
	SnapshotVolumes bool     `json:"snapshot_volumes"`
}

func (h *VeleroHandler) CreateBackup(w http.ResponseWriter, r *http.Request) {
	var req veleroBackupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "backup name is required")
		return
	}
	if err := h.kc.CreateVeleroBackup(r.Context(), req.Name, req.Namespaces, req.TTLHours, req.SnapshotVolumes); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "backup started"})
}

type veleroScheduleRequest struct {
	Name            string   `json:"name"`
	Schedule        string   `json:"schedule"`
	Namespaces      []string `json:"namespaces"`
	TTLHours        int      `json:"ttl_hours"`
	SnapshotVolumes bool     `json:"snapshot_volumes"`
}

func (h *VeleroHandler) CreateSchedule(w http.ResponseWriter, r *http.Request) {
	var req veleroScheduleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "schedule name is required")
		return
	}
	if err := h.kc.CreateVeleroSchedule(r.Context(), req.Name, req.Schedule, req.Namespaces, req.TTLHours, req.SnapshotVolumes); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "schedule created"})
}

type veleroRestoreRequest struct {
	Name       string `json:"name"`
	BackupName string `json:"backup_name"`
}

func (h *VeleroHandler) CreateRestore(w http.ResponseWriter, r *http.Request) {
	var req veleroRestoreRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "restore name is required")
		return
	}
	if err := h.kc.CreateVeleroRestore(r.Context(), req.Name, req.BackupName); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "restore started"})
}

func (h *VeleroHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if err := h.kc.DeleteVelero(r.Context(), chi.URLParam(r, "resource"), chi.URLParam(r, "name")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "deleted"})
}
