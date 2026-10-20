import { request_with_options } from './engine.mjs';
self.onmessage = ({data}) => {
  const {id, source, variables, options} = data;
  try {
    const config = JSON.stringify(options);
    const check = JSON.parse(request_with_options('check', source, variables, config));
    const expansion = JSON.parse(request_with_options('expand', source, variables, config));
    self.postMessage({id, check, expansion});
  } catch {
    self.postMessage({id, expansion:{exitCode:2,error:{code:'EngineError',message:'核心处理失败，请缩小输入后重试。'}}});
  }
};
