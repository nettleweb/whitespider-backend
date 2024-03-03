import worker from "worker_threads";
import { LlamaModel, LlamaContext, getLlama, Token } from "node-llama-cpp";

const port = worker.parentPort!;
if (worker.isMainThread)
	throw new Error("Invalid worker context");

let message = "";

for (const item of worker.workerData) {
	if (typeof item !== "object")
		throw new Error("Message entry must be an object.");

	const { role, content } = item;
	if (typeof content !== "string")
		throw new Error("Invalid message content: " + content);

	switch (role) {
		case "user":
			message += "### Instruction:\n" + content + "\n### Response:\n";
			break;
		case "assistant":
			message += content + "\n";
			break;
		default:
			throw new Error("Invalid message role: " + role);
	}
}

const model = new LlamaModel({
	llama: await getLlama({
		cuda: true,
		build: "auto"
	}),
	useMmap: false,
	useMlock: false,
	modelPath: "./local/mistral-7b-openorca.Q4_0.gguf",
	gpuLayers: 32,
});

const context = new LlamaContext({
	model: model,
	seed: 0,
	threads: 4,
	sequences: 1,
	batchSize: 128,
	contextSize: 2048,
});

const sequence = context.getSequence();
await sequence.clearHistory();

const tokens: Token[] = [];

for await (const token of sequence.evaluate(model.tokenize(message, true), {
	topK: 40,
	topP: 0.4,
	temperature: 0.8,
	evaluationPriority: 5,
})) {
	tokens.push(token);

	const text = model.detokenize(tokens);
	if (text.indexOf("<dummy32000>") > 0)
		break;

	port.postMessage(text);
}

sequence.dispose();
context.dispose();
model.dispose();
