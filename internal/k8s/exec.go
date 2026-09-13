package k8s

import (
	"bytes"
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
)

// ExecOptions configures a pod exec request.
type ExecOptions struct {
	Namespace string   `json:"namespace"`
	Pod       string   `json:"pod"`
	Container string   `json:"container"`
	Command   []string `json:"command"`
	Stdin     bool     `json:"stdin"`
}

// Exec runs a command inside a pod container and returns stdout and stderr.
func (c *Client) Exec(ctx context.Context, opts ExecOptions) (string, string, error) {
	req := c.getExecRequest(opts)

	executor, err := remotecommand.NewSPDYExecutor(c.RestConfig, "POST", req.URL())
	if err != nil {
		return "", "", fmt.Errorf("creating SPDY executor for %s/%s: %w", opts.Namespace, opts.Pod, err)
	}

	var stdout, stderr bytes.Buffer
	streamOpts := remotecommand.StreamOptions{
		Stdout: &stdout,
		Stderr: &stderr,
	}

	err = executor.StreamWithContext(ctx, streamOpts)
	if err != nil {
		return stdout.String(), stderr.String(), fmt.Errorf("exec in pod %s/%s: %w", opts.Namespace, opts.Pod, err)
	}
	return stdout.String(), stderr.String(), nil
}

// GetExecRequest builds a REST request for exec, suitable for WebSocket upgrade.
func (c *Client) GetExecRequest(namespace, pod, container string, command []string) *rest.Request {
	return c.getExecRequest(ExecOptions{
		Namespace: namespace,
		Pod:       pod,
		Container: container,
		Command:   command,
		Stdin:     true,
	})
}

func (c *Client) getExecRequest(opts ExecOptions) *rest.Request {
	req := c.Clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(opts.Pod).
		Namespace(opts.Namespace).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: opts.Container,
			Command:   opts.Command,
			Stdin:     opts.Stdin,
			Stdout:    true,
			Stderr:    true,
			TTY:       opts.Stdin,
		}, scheme.ParameterCodec)
	return req
}
