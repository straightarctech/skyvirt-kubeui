// App version + build commit, injected at build time from the repo VERSION file.
export const APP_VERSION: string = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0-dev";
export const APP_COMMIT: string = typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : "unknown";

/** Short display string, e.g. "v1.0.0". */
export const APP_VERSION_LABEL = `v${APP_VERSION}`;

/** Full build string for tooltips, e.g. "v1.0.0 (a1b2c3d)". */
export const APP_BUILD_LABEL = `v${APP_VERSION} (${APP_COMMIT})`;
