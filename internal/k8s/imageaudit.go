package k8s

import (
	"context"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ImageUse describes one distinct container image and where it runs.
type ImageUse struct {
	Image      string   `json:"image"`
	Registry   string   `json:"registry"`
	Repository string   `json:"repository"`
	Tag        string   `json:"tag"`
	Digest     string   `json:"digest,omitempty"`
	Mutable    bool     `json:"mutable"`     // :latest / untagged and not digest-pinned
	PullAlways bool     `json:"pull_always"` // any user sets imagePullPolicy: Always
	Workloads  []string `json:"workloads"`
}

// ImageAuditReport is the cluster's image-provenance inventory.
type ImageAuditReport struct {
	Images     []ImageUse     `json:"images"`
	Total      int            `json:"total"`
	Mutable    int            `json:"mutable"`
	Registries map[string]int `json:"registries"`
}

// ImageAudit inventories every distinct container image in use — its registry,
// tag, and whether it is pinned — and flags mutable references (:latest or
// untagged, not digest-pinned) that make a deployment unreproducible. It is
// read-only.
func (c *Client) ImageAudit(ctx context.Context) (*ImageAuditReport, error) {
	pods, err := c.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	imgs := map[string]*ImageUse{}
	wlSeen := map[string]map[string]bool{} // image -> set of workloads

	record := func(image, policy, workload string) {
		if image == "" {
			return
		}
		u := imgs[image]
		if u == nil {
			reg, repo, tag, digest := parseImageRef(image)
			u = &ImageUse{
				Image: image, Registry: reg, Repository: repo, Tag: tag, Digest: digest,
				Mutable: digest == "" && (tag == "" || tag == "latest"),
			}
			imgs[image] = u
			wlSeen[image] = map[string]bool{}
		}
		if policy == string(corev1.PullAlways) {
			u.PullAlways = true
		}
		if !wlSeen[image][workload] {
			wlSeen[image][workload] = true
			u.Workloads = append(u.Workloads, workload)
		}
	}

	for i := range pods.Items {
		pod := &pods.Items[i]
		wl := workloadKey(pod)
		all := append(append(append([]corev1.Container{}, pod.Spec.InitContainers...), pod.Spec.Containers...), ephemeralAsContainers(pod)...)
		for _, ct := range all {
			record(ct.Image, string(ct.ImagePullPolicy), wl)
		}
	}

	rep := &ImageAuditReport{Registries: map[string]int{}}
	for _, u := range imgs {
		sort.Strings(u.Workloads)
		rep.Images = append(rep.Images, *u)
		rep.Registries[u.Registry]++
		if u.Mutable {
			rep.Mutable++
		}
	}
	rep.Total = len(rep.Images)
	// Mutable first, then by image name.
	sort.Slice(rep.Images, func(a, b int) bool {
		if rep.Images[a].Mutable != rep.Images[b].Mutable {
			return rep.Images[a].Mutable
		}
		return rep.Images[a].Image < rep.Images[b].Image
	})
	return rep, nil
}

func ephemeralAsContainers(pod *corev1.Pod) []corev1.Container {
	out := make([]corev1.Container, 0, len(pod.Spec.EphemeralContainers))
	for _, e := range pod.Spec.EphemeralContainers {
		out = append(out, corev1.Container{Image: e.Image, ImagePullPolicy: e.ImagePullPolicy})
	}
	return out
}

// parseImageRef splits an image reference into registry, repository, tag, and
// digest. A missing registry defaults to docker.io; a missing tag is left empty
// (an implicit :latest).
func parseImageRef(ref string) (registry, repository, tag, digest string) {
	if i := strings.Index(ref, "@"); i >= 0 {
		digest = ref[i+1:]
		ref = ref[:i]
	}
	// The first path segment is a registry only if it looks like a host
	// (contains a "." or ":", or is "localhost").
	registry = "docker.io"
	if slash := strings.Index(ref, "/"); slash >= 0 {
		first := ref[:slash]
		if first == "localhost" || strings.ContainsAny(first, ".:") {
			registry = first
			ref = ref[slash+1:]
		}
	}
	if i := strings.LastIndex(ref, ":"); i >= 0 {
		tag = ref[i+1:]
		repository = ref[:i]
	} else {
		repository = ref
	}
	return registry, repository, tag, digest
}
