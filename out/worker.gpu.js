import worker from "worker_threads";
import { LlamaModel, LlamaContext, getLlama } from "node-llama-cpp";
const port = worker.parentPort;
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
            message += "<|im_start|>user\n" + content + "<|im_end|>\n<|im_start|>assistant\n";
            break;
        case "assistant":
            message += content + "<|im_end|>\n";
            break;
        default:
            throw new Error("Invalid message role: " + role);
    }
}
const model = new LlamaModel({
    llama: await getLlama({
        gpu: "cuda",
        build: "auto",
        skipDownload: true,
        usePrebuiltBinaries: false,
        existingPrebuiltBinaryMustMatchBuildOptions: true
    }),
    useMmap: false,
    useMlock: false,
    modelPath: "./local/Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf",
    gpuLayers: 32
});
const context = new LlamaContext({
    model: model,
    seed: 0,
    threads: 4,
    sequences: 1,
    batchSize: 128,
    contextSize: 2048
});
const sequence = context.getSequence({
    contextShift: {
        size: 8192,
        strategy: "eraseBeginning"
    }
});
const tokens = [];
for await (const token of sequence.evaluate(model.tokenize(message, true), {
    topK: 40,
    topP: 0.4,
    temperature: 0.8,
    evaluationPriority: 5
})) {
    tokens.push(token);
    port.postMessage(model.detokenize(tokens));
}
sequence.dispose();
context.dispose();
model.dispose();
