import worker from "worker_threads";
import gpt4all from "gpt4all";

const port = worker.parentPort!;
if (worker.isMainThread)
	throw new Error("Invalid worker context");

const model = await gpt4all.loadModel("mistral-7b-openorca.Q4_0.gguf", {
	type: "inference",
	device: "gpu",
	verbose: false,
	modelPath: "./local/",
	allowDownload: true
});
model.llm.setThreadCount(4);
model.config.systemPrompt = "";
model.config.promptTemplate = "### Human:\n%1\n### Assistant:\n";

const response = await gpt4all.createCompletion(model, worker.workerData, {
	contextErase: 0,
	logitsSize: 0,
	tokensSize: 0,
	nPredict: 2048,
	nBatch: 128,
	nPast: 0,
	nCtx: 0,
	topK: 40,
	topP: 0.4,
	temp: 0.8,
	repeatLastN: 64,
	repeatPenalty: 1.1,
});

model.dispose();
port.postMessage(response.choices[0].message.content);
