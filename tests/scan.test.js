import { describe, expect, test } from "bun:test";
import { extract, langOf, urlOf } from "../draw/extract.js";
import { aliasesOf, endpointFor, packageOf, psr4Of, resolverFor } from "../draw/resolve.js";

describe("extract", () => {
  test("reads a TypeScript file's imports, exports, routes and requests", () => {
    const found = extract("api/src/orders.ts", [
      "/** Orders: checkout and history. */",
      'import Stripe from "stripe";',
      'import { pay, type Receipt as R } from "./pay";',
      'export * from "./types";',
      'const db = require("../db");',
      "export async function listOrders() {}",
      'router.post("/orders/:id/refund", refund);',
      "await fetch(`${API}/stock/${id}`, { method: 'PUT' });",
      'axios.get("https://api.shippo.com/v1/labels");',
    ].join("\n"));
    expect(found.lang).toBe("js");
    expect(found.doc).toBe("Orders: checkout and history.");
    expect(found.imports).toEqual([{ spec: "stripe", names: ["Stripe"] }, { spec: "./pay", names: ["pay", "Receipt"] }, { spec: "./types", names: [] }, { spec: "../db", names: [] }]);
    expect(found.defs).toEqual(["listOrders"]);
    expect(found.routes).toEqual([{ m: "POST", p: "/orders/:id/refund", line: 7 }]);
    expect(found.requests).toEqual([{ m: "PUT", host: null, path: "/stock/:p", line: 8 }, { m: "GET", host: "api.shippo.com", path: "/v1/labels", line: 9 }]);
  });

  test("turns a Next.js route file into its endpoints", () => {
    const found = extract("web/app/(shop)/api/orders/[id]/route.ts", "export async function GET() {}\nexport const DELETE = handler;\n");
    expect(found.routes.map((route) => `${route.m} ${route.p}`)).toEqual(["GET /api/orders/:id", "DELETE /api/orders/:id"]);
  });

  test("reads Python's imports, definitions, FastAPI and Flask routes and requests", () => {
    const found = extract("app/views.py", [
      '"""The shop\'s pages."""',
      "from .models import Order, Item",
      "import requests, os",
      "@router.get('/orders/{order_id}')",
      "def order(order_id): ...",
      "@bp.route('/refund/<int:id>', methods=['POST'])",
      "def refund(id): ...",
      "requests.post(f'https://hooks.slack.com/{token}')",
    ].join("\n"));
    expect(found.doc).toBe("The shop's pages.");
    expect(found.imports).toEqual([{ spec: ".models", names: ["Order", "Item"] }, { spec: "requests", names: [] }, { spec: "os", names: [] }]);
    expect(found.defs).toEqual(["order", "refund"]);
    expect(found.routes.map((route) => `${route.m} ${route.p}`)).toEqual(["GET /orders/:order_id", "POST /refund/:id"]);
    expect(found.requests[0]).toMatchObject({ m: "POST", host: "hooks.slack.com" });
  });

  test("reads PHP's uses and Symfony routes under the class's own route", () => {
    const found = extract("src/Controller/OrderController.php", [
      "<?php",
      "use App\\Service\\Billing;",
      "use Stripe\\StripeClient;",
      "#[Route('/orders')]",
      "final class OrderController {",
      "  #[Route('/{id}/refund', methods: ['POST'])]",
      "  public function refund() {}",
      "}",
    ].join("\n"));
    expect(found.imports.map((one) => one.spec)).toEqual(["App\\Service\\Billing", "Stripe\\StripeClient"]);
    expect(found.defs).toEqual(["OrderController"]);
    expect(found.routes.map((route) => `${route.m} ${route.p}`)).toEqual(["POST /orders/:id/refund"]);
  });

  test("reads Go's imports and its routes, with Go 1.22 methods", () => {
    const found = extract("cmd/server/main.go", 'package main\n\nimport (\n  "net/http"\n  "example.com/tides/store"\n)\n\nfunc Serve() {\n  mux.HandleFunc("GET /tides/{port}", tides)\n  r.Post("/ports", addPort)\n}\n');
    expect(found.imports.map((one) => one.spec)).toEqual(["net/http", "example.com/tides/store"]);
    expect(found.routes.map((route) => `${route.m} ${route.p}`)).toEqual(["GET /tides/{port}", "POST /ports"]);
  });

  test("knows code from other files", () => {
    expect([langOf("a/b.tsx"), langOf("x.py"), langOf("run.sh"), langOf("README.md"), langOf("logo.png")]).toEqual(["js", "python", "shell", null, null]);
  });

  test("keeps an address's path, its variable parts as :p", () => {
    expect(urlOf("${base}/orders/${id}?full=1")).toEqual({ host: null, path: "/orders/:p" });
    expect(urlOf("https://api.stripe.com")).toEqual({ host: "api.stripe.com", path: "/" });
    expect(urlOf("${url}")).toBeNull();
  });
});

describe("resolve", () => {
  const files = [
    { path: "web/src/page.tsx", repo: "", lang: "js" },
    { path: "web/src/lib/client.ts", repo: "", lang: "js" },
    { path: "web/src/ui/index.tsx", repo: "", lang: "js" },
    { path: "api/app/__init__.py", repo: "", lang: "python" },
    { path: "api/app/models.py", repo: "", lang: "python" },
    { path: "api/app/views.py", repo: "", lang: "python" },
    { path: "php/src/Service/Billing.php", repo: "", lang: "php" },
    { path: "php/src/Controller/Orders.php", repo: "", lang: "php" },
  ];
  const resolve = resolverFor(files, {
    aliases: aliasesOf('{ // the web app\n "compilerOptions": { "baseUrl": "src", "paths": { "@lib/*": ["lib/*"], "ui": ["ui/index.tsx"], }, } }', "web"),
    psr4: psr4Of('{"autoload": {"psr-4": {"App\\\\": "src/"}}}', "php"),
  });
  const page = files[0];

  test("follows relative imports, tsconfig paths, exact names and baseUrl", () => {
    expect(resolve(page, "./lib/client").files).toEqual(["web/src/lib/client.ts"]);
    expect(resolve(page, "@lib/client").files).toEqual(["web/src/lib/client.ts"]);
    expect(resolve(page, "ui").files).toEqual(["web/src/ui/index.tsx"]);
    expect(resolve(page, "lib/client").files).toEqual(["web/src/lib/client.ts"]);
    expect(resolve(page, "react-dom/client")).toEqual({ files: [], pkg: "react-dom" });
    expect(resolve(page, "node:fs")).toEqual({ files: [], pkg: null });
  });

  test("follows Python's relative and absolute imports, a module named in from-import too", () => {
    const views = files[5];
    expect(resolve(views, ".models", ["Order"]).files).toEqual(["api/app/models.py"]);
    expect(resolve(views, ".", ["models"]).files).toEqual(["api/app/models.py"]);
    expect(resolve(views, "requests")).toEqual({ files: [], pkg: "requests" });
    expect(resolve(views, "json")).toEqual({ files: [], pkg: null });
  });

  test("follows PHP's uses through composer's PSR-4 roots", () => {
    expect(resolve(files[7], "App\\Service\\Billing").files).toEqual(["php/src/Service/Billing.php"]);
    expect(resolve(files[7], "Stripe\\StripeClient")).toEqual({ files: [], pkg: "Stripe" });
  });

  test("names packages as their registries do", () => {
    expect([packageOf("@sendgrid/mail/lib", "js"), packageOf("stripe", "js"), packageOf("fs", "js"), packageOf("github.com/gin-gonic/gin/render", "go")]).toEqual(["@sendgrid/mail", "stripe", null, "github.com/gin-gonic/gin"]);
  });
});

describe("endpointFor", () => {
  const routes = [
    { file: "api/orders.ts", m: "GET", p: "/api/orders/:id" },
    { file: "api/orders.ts", m: "POST", p: "/api/orders" },
    { file: "api/ports.ts", m: "ANY", p: "/ports" },
  ];
  const ask = (m, path) => endpointFor({ file: "web/client.ts", m, path }, routes)?.p ?? null;

  test("matches a request to the endpoint whose path it ends like", () => {
    expect(ask("GET", "/api/orders/:p")).toBe("/api/orders/:id");
    expect(ask("GET", "/orders/:p")).toBe("/api/orders/:id");
    expect(ask("POST", "/v2/api/orders")).toBe("/api/orders");
    expect(ask("ANY", "/ports")).toBe("/ports");
  });

  test("leaves a request with another method or no fixed part in common unmatched", () => {
    expect(ask("DELETE", "/api/orders")).toBeNull();
    expect(ask("GET", "/:p")).toBeNull();
    expect(ask("GET", "/tides")).toBeNull();
  });
});
