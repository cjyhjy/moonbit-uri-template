// Cancellation revokes queued callbacks as well as terminating the worker.
export function createRunner({ createWorker, onResult, onError, onPending,
  setTimer = setTimeout, clearTimer = clearTimeout, timeoutMs = 2000 }) {
  let worker, timer, generation = 0;
  function cancel() {
    generation++;
    worker?.terminate(); worker = undefined;
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  }
  function run(input) {
    cancel();
    const id = generation;
    onPending();
    const fail = (code, message) => {
      if (id !== generation) return;
      cancel();
      onError({ code, message });
    };
    try {
      worker = createWorker();
      worker.onerror = () => fail('WorkerError', '无法加载核心，请通过本地 HTTP 服务打开页面。');
      worker.onmessage = ({ data }) => {
        if (id !== generation || data.id !== id) return;
        cancel();
        onResult(data.result);
      };
      timer = setTimer(() => fail('TimeLimit', '计算超过 2 秒，请减小输入后重试。'), timeoutMs);
      worker.postMessage({ id, input });
    } catch { fail('WorkerError', '无法启动计算，请通过本地 HTTP 服务打开页面。'); }
  }
  return { run, cancel };
}
