package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
)

// PVSummary is the API-friendly persistent volume representation.
type PVSummary struct {
	Name          string    `json:"name"`
	Capacity      string    `json:"capacity"`
	AccessModes   []string  `json:"access_modes"`
	ReclaimPolicy string    `json:"reclaim_policy"`
	Status        string    `json:"status"`
	StorageClass  string    `json:"storage_class"`
	ClaimRef      string    `json:"claim_ref"`
	CreatedAt     time.Time `json:"created_at"`
}

// PVCSummary is the API-friendly persistent volume claim representation.
type PVCSummary struct {
	Name           string    `json:"name"`
	Namespace      string    `json:"namespace"`
	Status         string    `json:"status"`
	Volume         string    `json:"volume"`
	Capacity       string    `json:"capacity"`
	UsedBytes      *int64    `json:"used_bytes,omitempty"`
	CapacityBytes  *int64    `json:"capacity_bytes,omitempty"`
	AvailableBytes *int64    `json:"available_bytes,omitempty"`
	UsedPercent    *float64  `json:"used_percent,omitempty"`
	AccessModes    []string  `json:"access_modes"`
	StorageClass   string    `json:"storage_class"`
	CreatedAt      time.Time `json:"created_at"`
}

// StorageClassSummary is the API-friendly storage class representation.
type StorageClassSummary struct {
	Name                 string    `json:"name"`
	Provisioner          string    `json:"provisioner"`
	ReclaimPolicy        string    `json:"reclaim_policy"`
	VolumeBindingMode    string    `json:"volume_binding_mode"`
	AllowVolumeExpansion bool      `json:"allow_volume_expansion"`
	IsDefault            bool      `json:"is_default"`
	CreatedAt            time.Time `json:"created_at"`
}

func accessModeStrings(modes []corev1.PersistentVolumeAccessMode) []string {
	out := make([]string, len(modes))
	for i, m := range modes {
		out[i] = string(m)
	}
	return out
}

func toPVSummary(pv *corev1.PersistentVolume) PVSummary {
	var capacity string
	if qty, ok := pv.Spec.Capacity[corev1.ResourceStorage]; ok {
		capacity = qty.String()
	}
	var claimRef string
	if pv.Spec.ClaimRef != nil {
		claimRef = pv.Spec.ClaimRef.Namespace + "/" + pv.Spec.ClaimRef.Name
	}
	return PVSummary{
		Name:          pv.Name,
		Capacity:      capacity,
		AccessModes:   accessModeStrings(pv.Spec.AccessModes),
		ReclaimPolicy: string(pv.Spec.PersistentVolumeReclaimPolicy),
		Status:        string(pv.Status.Phase),
		StorageClass:  pv.Spec.StorageClassName,
		ClaimRef:      claimRef,
		CreatedAt:     pv.CreationTimestamp.Time,
	}
}

func toPVCSummary(pvc *corev1.PersistentVolumeClaim) PVCSummary {
	var capacity string
	if pvc.Status.Capacity != nil {
		if qty, ok := pvc.Status.Capacity[corev1.ResourceStorage]; ok {
			capacity = qty.String()
		}
	}
	var storageClass string
	if pvc.Spec.StorageClassName != nil {
		storageClass = *pvc.Spec.StorageClassName
	}
	return PVCSummary{
		Name:         pvc.Name,
		Namespace:    pvc.Namespace,
		Status:       string(pvc.Status.Phase),
		Volume:       pvc.Spec.VolumeName,
		Capacity:     capacity,
		AccessModes:  accessModeStrings(pvc.Spec.AccessModes),
		StorageClass: storageClass,
		CreatedAt:    pvc.CreationTimestamp.Time,
	}
}

func toStorageClassSummary(sc *storagev1.StorageClass) StorageClassSummary {
	var reclaimPolicy string
	if sc.ReclaimPolicy != nil {
		reclaimPolicy = string(*sc.ReclaimPolicy)
	}
	var bindingMode string
	if sc.VolumeBindingMode != nil {
		bindingMode = string(*sc.VolumeBindingMode)
	}
	isDefault := false
	for _, ann := range []string{
		"storageclass.kubernetes.io/is-default-class",
		"storageclass.beta.kubernetes.io/is-default-class",
	} {
		if v, ok := sc.Annotations[ann]; ok && strings.EqualFold(v, "true") {
			isDefault = true
			break
		}
	}
	allowExpansion := false
	if sc.AllowVolumeExpansion != nil {
		allowExpansion = *sc.AllowVolumeExpansion
	}
	return StorageClassSummary{
		Name:                 sc.Name,
		Provisioner:          sc.Provisioner,
		ReclaimPolicy:        reclaimPolicy,
		VolumeBindingMode:    bindingMode,
		AllowVolumeExpansion: allowExpansion,
		IsDefault:            isDefault,
		CreatedAt:            sc.CreationTimestamp.Time,
	}
}

// ListPVs returns all persistent volumes.
func (c *Client) ListPVs(ctx context.Context) ([]PVSummary, error) {
	list, err := c.Clientset.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing persistent volumes: %w", err)
	}
	out := make([]PVSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toPVSummary(&list.Items[i])
	}
	return out, nil
}

// ListPVCs returns persistent volume claims in a namespace. Pass "" for all namespaces.
func (c *Client) ListPVCs(ctx context.Context, namespace string) ([]PVCSummary, error) {
	list, err := c.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing persistent volume claims: %w", err)
	}
	out := make([]PVCSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toPVCSummary(&list.Items[i])
	}
	return out, nil
}

// ListStorageClasses returns all storage classes.
func (c *Client) ListStorageClasses(ctx context.Context) ([]StorageClassSummary, error) {
	list, err := c.Clientset.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing storage classes: %w", err)
	}
	out := make([]StorageClassSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toStorageClassSummary(&list.Items[i])
	}
	return out, nil
}

// CreatePV creates a persistent volume.
func (c *Client) CreatePV(ctx context.Context, pv *corev1.PersistentVolume) error {
	_, err := c.Clientset.CoreV1().PersistentVolumes().Create(ctx, pv, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("creating PV %s: %w", pv.Name, err)
	}
	return nil
}

// DeletePV deletes a persistent volume.
func (c *Client) DeletePV(ctx context.Context, name string) error {
	err := c.Clientset.CoreV1().PersistentVolumes().Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("deleting PV %s: %w", name, err)
	}
	return nil
}

// CreatePVC creates a persistent volume claim.
func (c *Client) CreatePVC(ctx context.Context, pvc *corev1.PersistentVolumeClaim) error {
	_, err := c.Clientset.CoreV1().PersistentVolumeClaims(pvc.Namespace).Create(ctx, pvc, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("creating PVC %s/%s: %w", pvc.Namespace, pvc.Name, err)
	}
	return nil
}

// DeletePVC deletes a persistent volume claim.
func (c *Client) DeletePVC(ctx context.Context, namespace, name string) error {
	err := c.Clientset.CoreV1().PersistentVolumeClaims(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("deleting PVC %s/%s: %w", namespace, name, err)
	}
	return nil
}

// ResizePVC expands a PVC to the given capacity (e.g. "20Gi").
// The StorageClass must have allowVolumeExpansion: true.
func (c *Client) ResizePVC(ctx context.Context, namespace, name, newCapacity string) error {
	// Validate the capacity string parses.
	if _, err := resource.ParseQuantity(newCapacity); err != nil {
		return fmt.Errorf("invalid capacity %q: %w", newCapacity, err)
	}

	patch := fmt.Sprintf(`{"spec":{"resources":{"requests":{"storage":"%s"}}}}`, newCapacity)
	_, err := c.Clientset.CoreV1().PersistentVolumeClaims(namespace).Patch(
		ctx, name, types.MergePatchType, []byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return fmt.Errorf("resizing PVC %s/%s: %w", namespace, name, err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// PVC usage from kubelet stats/summary
// ---------------------------------------------------------------------------

// pvcUsageKey is a namespace/name key for PVC usage lookup.
type pvcUsageKey struct {
	Namespace string
	Name      string
}

// PVCUsage holds filesystem usage for a PVC from kubelet stats.
type PVCUsage struct {
	UsedBytes      int64 `json:"usedBytes"`
	CapacityBytes  int64 `json:"capacityBytes"`
	AvailableBytes int64 `json:"availableBytes"`
}

// kubeletStatsSummary is a minimal representation of the kubelet stats/summary response.
type kubeletStatsSummary struct {
	Pods []kubeletPodStats `json:"pods"`
}

type kubeletPodStats struct {
	Volume []kubeletVolumeStats `json:"volume,omitempty"`
}

type kubeletVolumeStats struct {
	PVCRef         *kubeletPVCRef `json:"pvcRef,omitempty"`
	UsedBytes      *int64         `json:"usedBytes,omitempty"`
	CapacityBytes  *int64         `json:"capacityBytes,omitempty"`
	AvailableBytes *int64         `json:"availableBytes,omitempty"`
}

type kubeletPVCRef struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

// GetPVCUsage queries kubelet stats/summary on all nodes to collect
// filesystem usage for mounted PVCs.
func (c *Client) GetPVCUsage(ctx context.Context) (map[string]PVCUsage, error) {
	nodes, err := c.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing nodes: %w", err)
	}

	result := make(map[string]PVCUsage)
	transport, err := rest.TransportFor(c.RestConfig)
	if err != nil {
		return nil, fmt.Errorf("creating transport: %w", err)
	}
	httpClient := &http.Client{Transport: transport}

	for _, node := range nodes.Items {
		statsURL := fmt.Sprintf("%s/api/v1/nodes/%s/proxy/stats/summary",
			c.RestConfig.Host, node.Name)

		req, err := http.NewRequestWithContext(ctx, "GET", statsURL, nil)
		if err != nil {
			c.Logger.Warn("failed to create stats request", zap.String("node", node.Name), zap.Error(err))
			continue
		}

		resp, err := httpClient.Do(req)
		if err != nil {
			c.Logger.Warn("failed to get kubelet stats", zap.String("node", node.Name), zap.Error(err))
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 {
			c.Logger.Warn("kubelet stats non-200", zap.String("node", node.Name), zap.Int("status", resp.StatusCode))
			continue
		}

		var stats kubeletStatsSummary
		if err := json.Unmarshal(body, &stats); err != nil {
			c.Logger.Warn("failed to parse kubelet stats", zap.String("node", node.Name), zap.Error(err))
			continue
		}

		for _, pod := range stats.Pods {
			for _, vol := range pod.Volume {
				if vol.PVCRef == nil {
					continue
				}
				key := vol.PVCRef.Namespace + "/" + vol.PVCRef.Name
				usage := PVCUsage{}
				if vol.UsedBytes != nil {
					usage.UsedBytes = *vol.UsedBytes
				}
				if vol.CapacityBytes != nil {
					usage.CapacityBytes = *vol.CapacityBytes
				}
				if vol.AvailableBytes != nil {
					usage.AvailableBytes = *vol.AvailableBytes
				}
				result[key] = usage
			}
		}
	}

	return result, nil
}

// ListPVCsWithUsage returns PVCs enriched with filesystem usage data from kubelet stats.
func (c *Client) ListPVCsWithUsage(ctx context.Context, namespace string) ([]PVCSummary, error) {
	pvcs, err := c.ListPVCs(ctx, namespace)
	if err != nil {
		return nil, err
	}

	// Best-effort: get usage data but don't fail if kubelet stats are unavailable.
	usage, err := c.GetPVCUsage(ctx)
	if err != nil {
		c.Logger.Warn("failed to get PVC usage, returning without usage data", zap.Error(err))
		return pvcs, nil
	}

	for i := range pvcs {
		key := pvcs[i].Namespace + "/" + pvcs[i].Name
		if u, ok := usage[key]; ok {
			pvcs[i].UsedBytes = &u.UsedBytes
			pvcs[i].CapacityBytes = &u.CapacityBytes
			pvcs[i].AvailableBytes = &u.AvailableBytes
			if u.CapacityBytes > 0 {
				pct := float64(u.UsedBytes) / float64(u.CapacityBytes) * 100
				pvcs[i].UsedPercent = &pct
			}
		}
	}

	return pvcs, nil
}
