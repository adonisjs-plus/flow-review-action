import { c as setSecret, i as getInput, l as warning, n as FlowServer, o as saveState, r as OIDC_AUDIENCE, s as setFailed, t as getIdToken } from "./id_token-CXOJmNN9.js";
import { tmpdir } from "node:os";
import { execFile, spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { accessSync, constants, existsSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
//#endregion
//#region src/version.ts
/** The version of the Action. The server sends the reviewer of the same version. */
const VERSION = "0.5.0";
//#endregion
//#region src/reviewer.ts
/** The file name of the reviewer in its folder. */
const REVIEWER_FILE = "flow-reviewer.js";
/**
* Downloads the reviewer into a folder. Fails when the download does not
* match its sha256. Returns the path of the reviewer. The reviewer installs
* the package of its agent beside itself.
*/
async function prepareReviewer(dir, bundle, fetchFn = fetch) {
	await mkdir(dir, { recursive: true });
	const response = await fetchFn(bundle.url, { signal: AbortSignal.timeout(6e4) });
	if (!response.ok) throw new Error(`Cannot download the reviewer: ${response.status}`);
	const contents = Buffer.from(await response.arrayBuffer());
	if (createHash("sha256").update(contents).digest("hex") !== bundle.sha256) throw new Error("The downloaded reviewer does not match its sha256");
	await writeFile(join(dir, REVIEWER_FILE), contents);
	return join(dir, REVIEWER_FILE);
}
//#endregion
//#region src/sandbox.ts
const run = promisify(execFile);
const host = {
	platform: process.platform,
	async exec(command, args) {
		try {
			await run(command, args, { maxBuffer: 10485760 });
		} catch (error) {
			const stderr = error.stderr?.trim();
			throw new Error(stderr || error.message);
		}
	},
	exists: existsSync,
	has(command) {
		return (process.env.PATH ?? "").split(":").some((dir) => {
			try {
				accessSync(join(dir, command), constants.X_OK);
				return true;
			} catch {
				return false;
			}
		});
	},
	warn: (message) => warning(message),
	wait: (ms) => setTimeout(ms)
};
/**
* Prepares a Linux runner for the sandbox of the review, as
* `anthropics/claude-code-action` does: installs bubblewrap and socat with
* apt-get, with three tries, and allows the user namespaces of bubblewrap,
* which Ubuntu 23.10 and later block with AppArmor. It needs sudo with no
* password. A step that fails gives a warning: the reviewer checks the
* sandbox before the model starts, and stops with the reason.
*/
async function prepareSandbox(on = host) {
	if (on.platform !== "linux") return;
	const sudo = (...args) => on.exec("sudo", ["-n", ...args]);
	if (on.has("apt-get") && on.has("sudo")) for (let attempt = 1; attempt <= 3; attempt++) try {
		await sudo("apt-get", "update", "-qq");
		await sudo("apt-get", "install", "-y", "--no-install-recommends", "bubblewrap", "socat");
		break;
	} catch (error) {
		on.warn(`apt-get attempt ${attempt} failed: ${error.message}`);
		if (attempt < 3) await on.wait(5e3);
	}
	if (on.exists("/proc/sys/kernel/apparmor_restrict_unprivileged_userns") && on.has("sudo")) try {
		await sudo("sysctl", "-w", "kernel.apparmor_restrict_unprivileged_userns=0");
	} catch (error) {
		on.warn(`Cannot allow the user namespaces of bubblewrap: ${error.message}`);
	}
}
//#endregion
//#region src/main.ts
/**
* Gets a GitHub token and the reviewer from the Flow App server, prepares
* the runner for the sandbox of the review, then runs the review of the pull
* request in the payload.
*/
async function main() {
	const payload = getInput("payload", { required: true });
	let runId;
	try {
		runId = JSON.parse(payload).runId;
	} catch {
		throw new Error("The payload input is not valid JSON. Pass `inputs.payload` as it is");
	}
	const exchange = await new FlowServer(getInput("server-url")).exchange(await getIdToken(OIDC_AUDIENCE), {
		runId,
		version: VERSION
	});
	setSecret(exchange.token);
	saveState("token", exchange.token);
	if (runId) saveState("runId", runId);
	const [reviewer] = await Promise.all([prepareReviewer(join(process.env.RUNNER_TEMP ?? tmpdir(), "flow-reviewer"), exchange.bundle), prepareSandbox()]);
	const cwd = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd(), getInput("working-directory"));
	const code = await new Promise((done, fail) => {
		const child = spawn(process.execPath, [
			reviewer,
			"run",
			`--payload=${payload}`,
			`--max-budget=${getInput("max-budget")}`,
			`--cwd=${cwd}`
		], {
			stdio: "inherit",
			env: {
				...process.env,
				GITHUB_TOKEN: exchange.token
			}
		});
		child.on("error", fail);
		child.on("close", (exitCode) => done(exitCode ?? 1));
	});
	saveState("outcome", code === 0 ? "success" : "failure");
	if (code !== 0) setFailed(`The review failed with exit code ${code}`);
}
main().catch((error) => {
	saveState("outcome", "failure");
	setFailed(error.message);
});
//#endregion
export {};
