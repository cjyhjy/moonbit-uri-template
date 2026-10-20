import { evaluateRequest } from './compute.mjs';
self.onmessage = ({data}) => {
  const {id, input} = data;
  try {
    self.postMessage({id, result: evaluateRequest(input)});
  } catch {
    self.postMessage({id, result: {error:{code:'EngineError',message:'核心处理失败，请缩小输入后重试。'}}});
  }
};
