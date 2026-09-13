package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
)

// DeploymentSummaryFromUnstructured maps a watch event's object to the same
// summary ListDeployments returns, for typed deltas (patch-in-place).
func DeploymentSummaryFromUnstructured(u *unstructured.Unstructured) (any, error) {
	var d appsv1.Deployment
	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(u.Object, &d); err != nil {
		return nil, err
	}
	return toDeploymentSummary(&d), nil
}

// DeploymentCondition is a simplified deployment condition.
type DeploymentCondition struct {
	Type    string `json:"type"`
	Status  string `json:"status"`
	Reason  string `json:"reason"`
	Message string `json:"message"`
}

// DeploymentSummary is the API-friendly deployment representation.
type DeploymentSummary struct {
	Name              string                `json:"name"`
	Namespace         string                `json:"namespace"`
	Replicas          int32                 `json:"replicas"`
	ReadyReplicas     int32                 `json:"ready_replicas"`
	UpdatedReplicas   int32                 `json:"updated_replicas"`
	AvailableReplicas int32                 `json:"available_replicas"`
	Strategy          string                `json:"strategy"`
	Images            []string              `json:"images"`
	Labels            map[string]string     `json:"labels"`
	CreatedAt         time.Time             `json:"created_at"`
	Conditions        []DeploymentCondition `json:"conditions"`
}

func deploymentImages(d *appsv1.Deployment) []string {
	images := make([]string, 0, len(d.Spec.Template.Spec.Containers))
	for _, c := range d.Spec.Template.Spec.Containers {
		images = append(images, c.Image)
	}
	return images
}

func toDeploymentSummary(d *appsv1.Deployment) DeploymentSummary {
	var replicas int32
	if d.Spec.Replicas != nil {
		replicas = *d.Spec.Replicas
	}

	conditions := make([]DeploymentCondition, len(d.Status.Conditions))
	for i, c := range d.Status.Conditions {
		conditions[i] = DeploymentCondition{
			Type:    string(c.Type),
			Status:  string(c.Status),
			Reason:  c.Reason,
			Message: c.Message,
		}
	}

	return DeploymentSummary{
		Name:              d.Name,
		Namespace:         d.Namespace,
		Replicas:          replicas,
		ReadyReplicas:     d.Status.ReadyReplicas,
		UpdatedReplicas:   d.Status.UpdatedReplicas,
		AvailableReplicas: d.Status.AvailableReplicas,
		Strategy:          string(d.Spec.Strategy.Type),
		Images:            deploymentImages(d),
		Labels:            d.Labels,
		CreatedAt:         d.CreationTimestamp.Time,
		Conditions:        conditions,
	}
}

// ListDeployments returns deployments in a namespace. Pass "" for all namespaces.
func (c *Client) ListDeployments(ctx context.Context, namespace string) ([]DeploymentSummary, error) {
	list, err := c.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing deployments: %w", err)
	}
	out := make([]DeploymentSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toDeploymentSummary(&list.Items[i])
	}
	return out, nil
}

// GetDeployment returns a single deployment.
func (c *Client) GetDeployment(ctx context.Context, namespace, name string) (*DeploymentSummary, error) {
	d, err := c.Clientset.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("getting deployment %s/%s: %w", namespace, name, err)
	}
	s := toDeploymentSummary(d)
	return &s, nil
}

// ScaleDeployment sets the replica count for a deployment.
func (c *Client) ScaleDeployment(ctx context.Context, namespace, name string, replicas int32) error {
	scale, err := c.Clientset.AppsV1().Deployments(namespace).GetScale(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("getting scale for deployment %s/%s: %w", namespace, name, err)
	}
	scale.Spec.Replicas = replicas
	_, err = c.Clientset.AppsV1().Deployments(namespace).UpdateScale(ctx, name, scale, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("scaling deployment %s/%s to %d: %w", namespace, name, replicas, err)
	}
	return nil
}

// RestartDeployment triggers a rolling restart by patching the pod template annotation.
func (c *Client) RestartDeployment(ctx context.Context, namespace, name string) error {
	patch := fmt.Sprintf(`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().Format(time.RFC3339))
	_, err := c.Clientset.AppsV1().Deployments(namespace).Patch(ctx, name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
	if err != nil {
		return fmt.Errorf("restarting deployment %s/%s: %w", namespace, name, err)
	}
	return nil
}

// RollbackDeployment rolls back a deployment to its previous revision
// by reading the revision history and patching the deployment template
// with the previous ReplicaSet's pod template.
func (c *Client) RollbackDeployment(ctx context.Context, namespace, name string) error {
	// Get the deployment.
	deploy, err := c.Clientset.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("getting deployment %s/%s for rollback: %w", namespace, name, err)
	}

	// List all ReplicaSets owned by this deployment.
	rsList, err := c.Clientset.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("listing replicasets for rollback: %w", err)
	}

	// Find ReplicaSets owned by this deployment, sorted by revision.
	type rsRevision struct {
		rs       *appsv1.ReplicaSet
		revision int64
	}
	var owned []rsRevision
	for i := range rsList.Items {
		rs := &rsList.Items[i]
		for _, ref := range rs.OwnerReferences {
			if ref.UID == deploy.UID {
				rev := int64(0)
				if v, ok := rs.Annotations["deployment.kubernetes.io/revision"]; ok {
					fmt.Sscanf(v, "%d", &rev)
				}
				owned = append(owned, rsRevision{rs: rs, revision: rev})
				break
			}
		}
	}

	if len(owned) < 2 {
		return fmt.Errorf("deployment %s/%s has no previous revision to rollback to", namespace, name)
	}

	// Find the previous revision (second highest).
	var maxRev, prevRev int64
	var prevRS *appsv1.ReplicaSet
	for _, o := range owned {
		if o.revision > maxRev {
			maxRev = o.revision
		}
	}
	for _, o := range owned {
		if o.revision < maxRev && o.revision > prevRev {
			prevRev = o.revision
			prevRS = o.rs
		}
	}
	if prevRS == nil {
		return fmt.Errorf("deployment %s/%s: could not determine previous revision", namespace, name)
	}

	// Patch the deployment's pod template with the previous ReplicaSet's template.
	patchData, err := json.Marshal(map[string]interface{}{
		"spec": map[string]interface{}{
			"template": prevRS.Spec.Template,
		},
	})
	if err != nil {
		return fmt.Errorf("marshalling rollback patch: %w", err)
	}

	_, err = c.Clientset.AppsV1().Deployments(namespace).Patch(ctx, name, types.StrategicMergePatchType, patchData, metav1.PatchOptions{})
	if err != nil {
		return fmt.Errorf("rolling back deployment %s/%s: %w", namespace, name, err)
	}
	return nil
}

// DeleteDeployment deletes a deployment.
func (c *Client) DeleteDeployment(ctx context.Context, namespace, name string) error {
	err := c.Clientset.AppsV1().Deployments(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("deleting deployment %s/%s: %w", namespace, name, err)
	}
	return nil
}

// ReplicaSetSummary for deployment revision history.
type ReplicaSetSummary struct {
	Name          string            `json:"name"`
	Namespace     string            `json:"namespace"`
	Revision      string            `json:"revision"`
	Replicas      int32             `json:"replicas"`
	ReadyReplicas int32             `json:"ready_replicas"`
	Images        []string          `json:"images"`
	Labels        map[string]string `json:"labels"`
	CreatedAt     time.Time         `json:"created_at"`
}

// ListDeploymentReplicaSets returns ReplicaSets owned by a deployment,
// sorted by revision (highest first).
func (c *Client) ListDeploymentReplicaSets(ctx context.Context, namespace, deployName string) ([]ReplicaSetSummary, error) {
	// Get the deployment to find its UID.
	deploy, err := c.Clientset.AppsV1().Deployments(namespace).Get(ctx, deployName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("getting deployment %s/%s: %w", namespace, deployName, err)
	}

	// List all ReplicaSets in the namespace.
	rsList, err := c.Clientset.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing replicasets in %s: %w", namespace, err)
	}

	// Filter by owner reference matching the deployment UID.
	type rsWithRevision struct {
		summary  ReplicaSetSummary
		revision int64
	}
	var owned []rsWithRevision

	for i := range rsList.Items {
		rs := &rsList.Items[i]
		isOwned := false
		for _, ref := range rs.OwnerReferences {
			if ref.UID == deploy.UID {
				isOwned = true
				break
			}
		}
		if !isOwned {
			continue
		}

		revStr := rs.Annotations["deployment.kubernetes.io/revision"]
		var revNum int64
		if revStr != "" {
			fmt.Sscanf(revStr, "%d", &revNum)
		}

		images := make([]string, 0, len(rs.Spec.Template.Spec.Containers))
		for _, c := range rs.Spec.Template.Spec.Containers {
			images = append(images, c.Image)
		}

		var replicas int32
		if rs.Spec.Replicas != nil {
			replicas = *rs.Spec.Replicas
		}

		owned = append(owned, rsWithRevision{
			summary: ReplicaSetSummary{
				Name:          rs.Name,
				Namespace:     rs.Namespace,
				Revision:      revStr,
				Replicas:      replicas,
				ReadyReplicas: rs.Status.ReadyReplicas,
				Images:        images,
				Labels:        rs.Labels,
				CreatedAt:     rs.CreationTimestamp.Time,
			},
			revision: revNum,
		})
	}

	// Sort by revision descending (highest/newest first).
	for i := 0; i < len(owned); i++ {
		for j := i + 1; j < len(owned); j++ {
			if owned[j].revision > owned[i].revision {
				owned[i], owned[j] = owned[j], owned[i]
			}
		}
	}

	result := make([]ReplicaSetSummary, len(owned))
	for i, o := range owned {
		result[i] = o.summary
	}

	return result, nil
}
