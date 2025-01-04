export default (
  server: Whistle.PluginServer,
  options: Whistle.PluginOptions
) => {
  // 存储请求超时配置
  const timeoutMap = new Map<string, number>();
  // 存储当前重试次数
  const retryCountMap = new Map<string, number>();
  // 最大重试次数
  const MAX_RETRY_COUNT = 5;

  // 处理重试请求的函数
  const handleRetry = (
    req: Whistle.PluginServerRequest,
    res: Whistle.PluginServerResponse,
    timeout: number
  ) => {
    const reqId = req.originalReq.id;
    const currentRetryCount = retryCountMap.get(reqId) || 0;

    if (currentRetryCount >= MAX_RETRY_COUNT) {
      // 达到最大重试次数，返回最后一次失败
      console.log(
        `请求 ${req.originalReq.fullUrl} 达到最大重试次数 ${MAX_RETRY_COUNT}`
      );
      return;
    }

    retryCountMap.set(reqId, currentRetryCount + 1);
    console.log(
      `请求 ${req.originalReq.fullUrl} 开始第 ${currentRetryCount + 1} 次重试`
    );

    req.getReqSession((s) => {
      if (!s) return;
      const retryReq = {
        url: req.originalReq.fullUrl,
        method: req.originalReq.method,
        headers: s.req.headers,
        body: s.req.body,
      };

      req.request(retryReq, (retryRes) => {
        // 创建新的超时计时器
        const timer = setTimeout(() => {
          retryRes.destroy();
          handleRetry(req, res, timeout);
        }, timeout);

        retryRes.on("end", () => {
          clearTimeout(timer);
          timeoutMap.delete(reqId);
          retryCountMap.delete(reqId);
        });

        res.writeHead(retryRes.statusCode, retryRes.headers);
        retryRes.pipe(res);
      });
    });
  };

  // 处理请求
  server.on(
    "request",
    async (
      req: Whistle.PluginServerRequest,
      res: Whistle.PluginServerResponse
    ) => {
      const { ruleValue } = req.originalReq;
      if (ruleValue) {
        const timeout = Number.parseInt(ruleValue);
        if (!Number.isNaN(timeout)) {
          timeoutMap.set(req.originalReq.id, timeout);
        }
      }

      const reqId = req.originalReq.id;
      const timeout = timeoutMap.get(reqId);

      if (!timeout) {
        // 没有配置超时重试,直接透传
        req.passThrough();
        return;
      }

      // 创建超时计时器
      const timer = setTimeout(() => {
        req.destroy();
        handleRetry(req, res, timeout);
      }, timeout);

      res.on("finish", () => {
        clearTimeout(timer);
        timeoutMap.delete(reqId);
        retryCountMap.delete(reqId);
      });

      req.passThrough();
    }
  );
};
