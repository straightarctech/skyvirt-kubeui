package k8s

import (
	"context"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type PDBSummary struct {
	Name               string            `json:"name"`
	Namespace          string            `json:"namespace"`
	MinAvailable       string            `json:"min_available"`
	MaxUnavailable     string            `json:"max_unavailable"`
	CurrentHealthy     int32             `json:"current_healthy"`
	DesiredHealthy     int32             `json:"desired_healthy"`
	DisruptionsAllowed int32             `json:"disruptions_allowed"`
	ExpectedPods       int32             `json:"expected_pods"`
	Selector           map[string]string `json:"selector"`
	Labels             map[string]string `json:"labels"`
	CreatedAt          time.Time         `json:"created_at"`
}

func (c *Client) ListPDBs(ctx context.Context, namespace string) ([]PDBSummary, error) {
	list, err := c.Clientset.PolicyV1().PodDisruptionBudgets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing PDBs: %w", err)
	}
	out := make([]PDBSummary, len(list.Items))
	for i := range list.Items {
		pdb := &list.Items[i]
		minAvail := ""
		if pdb.Spec.MinAvailable != nil {
			minAvail = pdb.Spec.MinAvailable.String()
		}
		maxUnavail := ""
		if pdb.Spec.MaxUnavailable != nil {
			maxUnavail = pdb.Spec.MaxUnavailable.String()
		}
		var sel map[string]string
		if pdb.Spec.Selector != nil {
			sel = pdb.Spec.Selector.MatchLabels
		}
		out[i] = PDBSummary{
			Name:               pdb.Name,
			Namespace:          pdb.Namespace,
			MinAvailable:       minAvail,
			MaxUnavailable:     maxUnavail,
			CurrentHealthy:     pdb.Status.CurrentHealthy,
			DesiredHealthy:     pdb.Status.DesiredHealthy,
			DisruptionsAllowed: pdb.Status.DisruptionsAllowed,
			ExpectedPods:       pdb.Status.ExpectedPods,
			Selector:           sel,
			Labels:             pdb.Labels,
			CreatedAt:          pdb.CreationTimestamp.Time,
		}
	}
	return out, nil
}

func (c *Client) DeletePDB(ctx context.Context, namespace, name string) error {
	if err := c.Clientset.PolicyV1().PodDisruptionBudgets(namespace).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return fmt.Errorf("deleting PDB %s/%s: %w", namespace, name, err)
	}
	return nil
}
