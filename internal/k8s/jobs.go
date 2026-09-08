package k8s

import (
	"context"
	"fmt"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// JobConditionInfo is a simplified job condition.
type JobConditionInfo struct {
	Type   string `json:"type"`
	Status string `json:"status"`
	Reason string `json:"reason"`
}

// JobSummary is the API-friendly job representation.
type JobSummary struct {
	Name        string             `json:"name"`
	Namespace   string             `json:"namespace"`
	Completions int32              `json:"completions"`
	Succeeded   int32              `json:"succeeded"`
	Failed      int32              `json:"failed"`
	Active      int32              `json:"active"`
	Duration    string             `json:"duration"`
	Conditions  []JobConditionInfo `json:"conditions"`
	CreatedAt   time.Time          `json:"created_at"`
}

// CronJobSummary is the API-friendly cronjob representation.
type CronJobSummary struct {
	Name         string    `json:"name"`
	Namespace    string    `json:"namespace"`
	Schedule     string    `json:"schedule"`
	Suspend      bool      `json:"suspend"`
	ActiveCount  int        `json:"active_count"`
	LastSchedule *time.Time `json:"last_schedule"`
	CreatedAt    time.Time  `json:"created_at"`
}

func toJobSummary(j *batchv1.Job) JobSummary {
	var completions int32
	if j.Spec.Completions != nil {
		completions = *j.Spec.Completions
	}

	var duration string
	if j.Status.StartTime != nil {
		end := time.Now()
		if j.Status.CompletionTime != nil {
			end = j.Status.CompletionTime.Time
		}
		d := end.Sub(j.Status.StartTime.Time)
		duration = d.Truncate(time.Second).String()
	}

	conditions := make([]JobConditionInfo, len(j.Status.Conditions))
	for i, c := range j.Status.Conditions {
		conditions[i] = JobConditionInfo{
			Type:   string(c.Type),
			Status: string(c.Status),
			Reason: c.Reason,
		}
	}

	return JobSummary{
		Name:        j.Name,
		Namespace:   j.Namespace,
		Completions: completions,
		Succeeded:   j.Status.Succeeded,
		Failed:      j.Status.Failed,
		Active:      j.Status.Active,
		Duration:    duration,
		Conditions:  conditions,
		CreatedAt:   j.CreationTimestamp.Time,
	}
}

func toCronJobSummary(cj *batchv1.CronJob) CronJobSummary {
	var suspend bool
	if cj.Spec.Suspend != nil {
		suspend = *cj.Spec.Suspend
	}

	// Pointer so a never-scheduled cronjob serializes to null (not the Go
	// zero-time "0001-01-01T00:00:00Z", which is truthy in the UI).
	var lastSchedule *time.Time
	if cj.Status.LastScheduleTime != nil {
		lastSchedule = &cj.Status.LastScheduleTime.Time
	}

	return CronJobSummary{
		Name:         cj.Name,
		Namespace:    cj.Namespace,
		Schedule:     cj.Spec.Schedule,
		Suspend:      suspend,
		ActiveCount:  len(cj.Status.Active),
		LastSchedule: lastSchedule,
		CreatedAt:    cj.CreationTimestamp.Time,
	}
}

// ListJobs returns jobs in a namespace. Pass "" for all namespaces.
func (c *Client) ListJobs(ctx context.Context, namespace string) ([]JobSummary, error) {
	list, err := c.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing jobs: %w", err)
	}
	out := make([]JobSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toJobSummary(&list.Items[i])
	}
	return out, nil
}

// DeleteJob deletes a job.
func (c *Client) DeleteJob(ctx context.Context, namespace, name string) error {
	propagation := metav1.DeletePropagationBackground
	err := c.Clientset.BatchV1().Jobs(namespace).Delete(ctx, name, metav1.DeleteOptions{
		PropagationPolicy: &propagation,
	})
	if err != nil {
		return fmt.Errorf("deleting job %s/%s: %w", namespace, name, err)
	}
	return nil
}

// ListCronJobs returns cronjobs in a namespace. Pass "" for all namespaces.
func (c *Client) ListCronJobs(ctx context.Context, namespace string) ([]CronJobSummary, error) {
	list, err := c.Clientset.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing cronjobs: %w", err)
	}
	out := make([]CronJobSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toCronJobSummary(&list.Items[i])
	}
	return out, nil
}

// SuspendCronJob toggles the suspend flag on a cronjob.
func (c *Client) SuspendCronJob(ctx context.Context, namespace, name string, suspend bool) error {
	cj, err := c.Clientset.BatchV1().CronJobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("getting cronjob %s/%s: %w", namespace, name, err)
	}
	cj.Spec.Suspend = &suspend
	_, err = c.Clientset.BatchV1().CronJobs(namespace).Update(ctx, cj, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("updating cronjob %s/%s: %w", namespace, name, err)
	}
	return nil
}

// DeleteCronJob deletes a cronjob.
func (c *Client) DeleteCronJob(ctx context.Context, namespace, name string) error {
	err := c.Clientset.BatchV1().CronJobs(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("deleting cronjob %s/%s: %w", namespace, name, err)
	}
	return nil
}
