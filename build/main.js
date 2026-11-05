import { c as setSecret, i as getInput, n as FlowServer, o as saveState, r as OIDC_AUDIENCE, s as setFailed, t as getIdToken } from "./id_token-j0JDl5lW.js";
import { tmpdir } from "node:os";
import { execFile, spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
//#endregion
//#region src/version.ts
/** The version of the Action. The server sends the reviewer of the same version. */
const VERSION = "0.4.3";
//#endregion
//#region src/reviewer.ts
const run = promisify(execFile);
/** The file name of the reviewer in its folder. */
const REVIEWER_FILE = "flow-reviewer.js";
/** Installs the Claude Agent SDK into a folder, so the reviewer there can import it. */
async function installSdk(dir, version) {
	await run("npm", [
		"install",
		"--no-save",
		"--no-audit",
		"--no-fund",
		"--prefix",
		dir,
		`@anthropic-ai/claude-agent-sdk@${version}`
	], { maxBuffer: 10485760 });
}
/**
* Downloads the reviewer into a folder and installs the Claude Agent SDK
* beside it, at the same time. Fails when the download does not match its
* sha256. Returns the path of the reviewer.
*/
async function prepareReviewer(dir, bundle, deps = {}) {
	const fetchFn = deps.fetchFn ?? fetch;
	const install = deps.install ?? installSdk;
	await mkdir(dir, { recursive: true });
	const download = async () => {
		const response = await fetchFn(bundle.url, { signal: AbortSignal.timeout(6e4) });
		if (!response.ok) throw new Error(`Cannot download the reviewer: ${response.status}`);
		const contents = Buffer.from(await response.arrayBuffer());
		if (createHash("sha256").update(contents).digest("hex") !== bundle.sha256) throw new Error("The downloaded reviewer does not match its sha256");
		await writeFile(join(dir, REVIEWER_FILE), contents);
	};
	await Promise.all([download(), install(dir, bundle.sdkVersion)]);
	return join(dir, REVIEWER_FILE);
}
//#endregion
//#region src/main.ts
/**
* Gets a GitHub token and the reviewer from the Flow App server, then runs
* the review of the pull request in the payload.
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
	const reviewer = await prepareReviewer(join(process.env.RUNNER_TEMP ?? tmpdir(), "flow-reviewer"), exchange.bundle);
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
