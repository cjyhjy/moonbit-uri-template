# 公共 API 客户端

两个只读客户端，地址都由 SDK 生成：

- `npmVersion(name, version)`：查询 npm 包的某个版本。scoped 包作为一个路径参数编码，`@types/node` 得到 `%40types%2Fnode`。
- `book(isbn)`：查询 Open Library 的图书信息，`ISBN:` 中的冒号编码为 `%3A`。

客户端固定 HTTPS 来源，禁止重定向，超时 15 秒，响应上限 1 MiB，并核对返回的包名、版本或书名。

```sh
npm run test:public-clients   # 离线测试
npm run integration:public    # 3 个真实 GET，记录到 reports/public-clients-live.json
```

接口资料：[npm registry](https://docs.npmjs.com/using-npm/registry.html)、[Open Library Books API](https://openlibrary.org/dev/docs/api/books)。
