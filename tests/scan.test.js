import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract, langOf, urlOf } from "../draw/extract.js";
import { aliasesOf, cargoCrateOf, endpointFor, packageOf, psr4Of, resolverFor, withoutComments } from "../draw/resolve.js";
import { connect, scan } from "../draw/scan.js";

describe("extract", () => {
  test("numbers the lines of a big file's requests and routes as fast as a small one's", () => {
    const text = Array.from({ length: 60000 }, (_, index) => `export const get${index} = () => fetch("/api/tides/${index}");`).join("\n");
    const started = performance.now();
    const found = extract("src/client.ts", text);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(found.requests).toHaveLength(60000);
    expect(found.requests.at(-1)).toMatchObject({ path: "/api/tides/59999", line: 60000 });
    expect(extract("app.py", `import x\n\n@app.get("/a")\ndef a(): pass\n\n\n@app.post("/b")\ndef b(): pass\n`).routes.map((route) => route.line)).toEqual([3, 7]);
  });

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
    expect(found.imports).toEqual([{ spec: "stripe", names: ["Stripe"] }, { spec: "./pay", names: ["pay", "Receipt"] }, { spec: "./types", names: [] }, { spec: "../db", names: ["db"] }]);
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

  test("reads Java's package, imports and top-level types", () => {
    const found = extract("billing/src/main/java/com/shop/billing/Invoice.java", [
      "package com.shop.billing;",
      "",
      "import com.stripe.model.Customer;",
      "import static com.shop.billing.Totals.sum;",
      "import com.shop.orders.*;",
      "",
      "@Entity",
      "public final class Invoice {",
      "  public static class Line {}",
      "}",
      "record Draft(String id) {}",
    ].join("\n"));
    expect(found.lang).toBe("jvm");
    expect(found.namespace).toBe("com.shop.billing");
    expect(found.imports).toEqual([{ spec: "com.stripe.model.Customer", names: ["Customer"] }, { spec: "com.shop.billing.Totals.sum", names: ["sum"] }, { spec: "com.shop.orders.*", names: [] }]);
    expect(found.defs).toEqual(["Invoice", "Draft"]);
  });

  test("reads Kotlin's top-level classes, objects, functions and values, not its private ones", () => {
    const found = extract("app/src/main/kotlin/orders/OrderScreen.kt", [
      "package com.shop.orders",
      "",
      "import com.shop.billing.Invoice as Bill",
      "import kotlinx.coroutines.flow.Flow",
      "",
      "@Composable fun OrderScreen(orders: List<Order>) {}",
      "fun <T : Comparable<T>> List<T>.newestFirst(): List<T> = sortedDescending()",
      "const val PAGE_SIZE = 20",
      "data class Order(val id: String)",
      "object Orders {",
      "    fun inside() {}",
      "}",
      "private fun hidden() {}",
    ].join("\n"));
    expect(found.namespace).toBe("com.shop.orders");
    expect(found.imports).toEqual([{ spec: "com.shop.billing.Invoice", names: ["Invoice"] }, { spec: "kotlinx.coroutines.flow.Flow", names: ["Flow"] }]);
    expect(found.defs).toEqual(["OrderScreen", "newestFirst", "PAGE_SIZE", "Order", "Orders"]);
  });

  test("reads Rust's modules, uses and public items at the file's top level only", () => {
    const found = extract("src/orders.rs", [
      "//! Orders and refunds.",
      "pub mod refunds;",
      "#[cfg(test)]",
      "mod tests;",
      "use std::io::{self, Write};",
      "use crate::billing::{invoice::Invoice, self};",
      "use super::Config as Settings;",
      "use serde::{",
      "    Deserialize,",
      "    Serialize,",
      "};",
      "pub extern crate shop_core as core;",
      "pub struct Order;",
      "pub(crate) fn place() {}",
      "fn private_one() {}",
      "impl Order {",
      "    pub fn total(&self) {}",
      "}",
      "mod inline {",
      "    use super::*;",
      "}",
      'const HELP: &str = "',
      'use the --refund flag; to undo";',
    ].join("\n"));
    expect(found.lang).toBe("rust");
    expect(found.doc).toBe("Orders and refunds.");
    expect(found.imports.map((one) => one.spec)).toEqual([
      "self::refunds", "self::tests", "std::io", "std::io::Write", "crate::billing::invoice::Invoice", "crate::billing", "super::Config", "serde::Deserialize", "serde::Serialize", "shop_core",
    ]);
    expect(found.imports[4].names).toEqual(["Invoice"]);
    expect(found.defs).toEqual(["refunds", "Order", "place"]);
  });

  test("leaves Scala and Groovy unread", () => {
    expect(extract("src/Main.scala", "package shop\nimport shop.orders._\nclass Main\n").imports).toEqual([]);
  });

  test("reads Python's imports that run over lines, as Black writes them", () => {
    const found = extract("app/main.py", "from app.core.config import (\n    settings,\n    Other as O,  # the other one\n)\nfrom .models import (User,\n Order)\n");
    expect(found.imports).toEqual([{ spec: "app.core.config", names: ["settings", "Other"] }, { spec: ".models", names: ["User", "Order"] }]);
  });

  test("reads where routers are mounted, and a router's own prefix", () => {
    expect(extract("api/app.ts", 'const orders = require("./orders");\napp.use("/api/orders", auth, orders);\napp.route("/v2", v2.app);\nfastify.register(users, { prefix: "/users" });').mounts)
      .toEqual([{ prefix: "/api/orders", name: "orders" }, { prefix: "/v2", name: "v2" }, { prefix: "/users", name: "users" }]);
    expect(extract("app/routes/orders.py", 'router = APIRouter(tags=["orders"], prefix="/orders")\n').prefix).toBe("/orders");
    expect(extract("app/main.py", 'app.include_router(orders.router, prefix="/api")\napp.register_blueprint(shop.bp, url_prefix="/shop")\n').mounts)
      .toEqual([{ prefix: "/api", name: "orders" }, { prefix: "/shop", name: "shop" }]);
  });

  test("knows code from other files", () => {
    expect([langOf("a/b.tsx"), langOf("x.py"), langOf("run.sh"), langOf("README.md"), langOf("logo.png")]).toEqual(["js", "python", "shell", null, null]);
  });

  test("keeps an address's path, its variable parts as :p", () => {
    expect(urlOf("${base}/orders/${id}?full=1")).toEqual({ host: null, path: "/orders/:p" });
    expect(urlOf("https://api.stripe.com")).toEqual({ host: "api.stripe.com", path: "/" });
    expect(urlOf("${url}")).toBeNull();
  });

  test("keeps the path of an address whose host or port is a variable", () => {
    expect(urlOf("http://${host}/orders")).toEqual({ host: null, path: "/orders" });
    expect(urlOf("http://localhost:${PORT}/api/orders")).toEqual({ host: "localhost", path: "/api/orders" });
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

  test("follows an import to a project's own .d.ts file only when no code file answers it", () => {
    const typed = [
      { path: "app/src/deck.ts", repo: "", lang: "js" },
      { path: "app/types/index.d.ts", repo: "", lang: "js" },
      { path: "app/src/tides.ts", repo: "", lang: "js" },
      { path: "app/src/tides.d.ts", repo: "", lang: "js" },
      { path: "app/src/lib/thing.js", repo: "", lang: "js" },
      { path: "app/src/lib/thing.d.ts", repo: "", lang: "js" },
      { path: "app/src/env.d.ts", repo: "", lang: "js" },
    ];
    const resolveTyped = resolverFor(typed);
    const deck = typed[0];
    expect(resolveTyped(deck, "../types").files).toEqual(["app/types/index.d.ts"]);
    expect(resolveTyped(deck, "./tides").files).toEqual(["app/src/tides.ts"]);
    expect(resolveTyped(deck, "./lib/thing").files).toEqual(["app/src/lib/thing.js"]);
    expect(resolveTyped(deck, "./env").files).toEqual(["app/src/env.d.ts"]);
  });

  test("reads a tsconfig with globs in its strings and comments around them, as Next.js writes it", () => {
    const next = '{\n  // Next.js\n  "compilerOptions": { /* where */ "baseUrl": ".", "paths": { "@/*": ["./src/*"] } },\n  "include": ["**/*.ts", "**/*.tsx"],\n}';
    expect(JSON.parse(withoutComments(next)).include).toEqual(["**/*.ts", "**/*.tsx"]);
    expect(aliasesOf(next, "web")[0]).toEqual({ dir: "web", prefix: "@/", isExact: false, targets: ["web/src"] });
  });

  test("follows Python's imports rooted in a folder below the repo's top", () => {
    const backend = [
      { path: "backend/app/__init__.py", repo: "", lang: "python" },
      { path: "backend/app/main.py", repo: "", lang: "python" },
      { path: "backend/app/core/__init__.py", repo: "", lang: "python" },
      { path: "backend/app/core/config.py", repo: "", lang: "python" },
    ];
    const resolveBackend = resolverFor(backend);
    expect(resolveBackend(backend[1], "app.core.config", ["settings"]).files).toEqual(["backend/app/core/config.py"]);
    expect(resolveBackend(backend[1], "config")).toEqual({ files: [], pkg: "config" });
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

  test("follows Java's and Kotlin's imports through the packages their files declare", () => {
    const jvm = [
      { path: "billing/src/main/java/com/shop/billing/Invoice.java", repo: "", lang: "jvm", namespace: "com.shop.billing", defs: ["Invoice"] },
      { path: "app/src/main/kotlin/orders/OrderScreen.kt", repo: "", lang: "jvm", namespace: "com.shop.orders", defs: ["OrderScreen", "PAGE_SIZE"] },
      { path: "app/src/main/kotlin/orders/Formats.kt", repo: "", lang: "jvm", namespace: "com.shop.orders", defs: ["formatTotal"] },
    ];
    const resolveJvm = resolverFor(jvm);
    const screen = jvm[1];
    expect(resolveJvm(screen, "com.shop.billing.Invoice").files).toEqual(["billing/src/main/java/com/shop/billing/Invoice.java"]);
    expect(resolveJvm(screen, "com.shop.orders.formatTotal").files).toEqual(["app/src/main/kotlin/orders/Formats.kt"]);
    expect(resolveJvm(screen, "com.shop.billing.Invoice.Line").files).toEqual(["billing/src/main/java/com/shop/billing/Invoice.java"]);
    expect(resolveJvm(screen, "com.shop.billing.Invoice.create").files).toEqual(["billing/src/main/java/com/shop/billing/Invoice.java"]);
    expect(resolveJvm(screen, "com.shop.orders.*").files).toEqual(["app/src/main/kotlin/orders/OrderScreen.kt", "app/src/main/kotlin/orders/Formats.kt"]);
    expect(resolveJvm(screen, "com.stripe.model.Customer")).toEqual({ files: [], pkg: "com.stripe" });
    expect(resolveJvm(screen, "java.util.List")).toEqual({ files: [], pkg: null });
  });

  test("takes an import of the project's own code that leads to no file for no outside package", () => {
    const petclinic = [{ path: "src/owner/OwnerController.java", repo: "", lang: "jvm", namespace: "org.springframework.samples.petclinic.owner", defs: ["OwnerController"] }];
    const resolveOwn = resolverFor(petclinic);
    expect(resolveOwn(petclinic[0], "org.springframework.samples.petclinic.R")).toEqual({ files: [], pkg: null });
    expect(resolveOwn(petclinic[0], "org.springframework.stereotype.Controller")).toEqual({ files: [], pkg: "org.springframework" });
  });

  test("follows Rust's modules and uses through the crate's folders and the workspace's crates", () => {
    const rust = ["src/lib.rs", "src/main.rs", "src/orders.rs", "src/orders/refunds.rs", "src/billing/mod.rs", "src/billing/invoice.rs", "tests/checkout.rs", "tests/common/mod.rs", "crates/core/src/lib.rs", "crates/core/src/money.rs"]
      .map((path) => ({ path, repo: "", lang: "rust" }));
    const at = (path) => rust.find((file) => file.path === path);
    const resolveRust = resolverFor(rust, { crates: [cargoCrateOf('[package]\nname = "shop"\n', ""), cargoCrateOf('[package]\nname = "shop-core"\n', "crates/core")] });
    const leads = (from, spec) => resolveRust(at(from), spec).files;
    expect(leads("src/lib.rs", "self::orders")).toEqual(["src/orders.rs"]);
    expect(leads("src/orders.rs", "self::refunds")).toEqual(["src/orders/refunds.rs"]);
    expect(leads("src/billing/mod.rs", "self::invoice")).toEqual(["src/billing/invoice.rs"]);
    expect(leads("src/orders/refunds.rs", "super::Order")).toEqual(["src/orders.rs"]);
    expect(leads("src/orders/refunds.rs", "crate::billing::invoice::Invoice")).toEqual(["src/billing/invoice.rs"]);
    expect(leads("src/orders/refunds.rs", "crate::Config")).toEqual(["src/lib.rs"]);
    expect(leads("src/lib.rs", "billing::invoice")).toEqual(["src/billing/invoice.rs"]);
    expect(leads("src/main.rs", "shop::orders::Order")).toEqual(["src/orders.rs"]);
    expect(leads("src/orders.rs", "shop_core::money::Money")).toEqual(["crates/core/src/money.rs"]);
    expect(leads("tests/checkout.rs", "self::common")).toEqual(["tests/common/mod.rs"]);
    expect(resolveRust(at("src/orders.rs"), "serde::Serialize")).toEqual({ files: [], pkg: "serde" });
    expect(resolveRust(at("src/orders.rs"), "std::io::Write")).toEqual({ files: [], pkg: null });
  });

  test("names a crate as its code uses it, and none for a workspace's own Cargo.toml", () => {
    expect(cargoCrateOf('[package]\nname = "grep-searcher"\nversion = "0.1.0"\n\n[dependencies]\nname = "not-this"\n', "crates/searcher")).toEqual({ dir: "crates/searcher", name: "grep_searcher" });
    expect(cargoCrateOf('[package]\nname = "ripgrep"\n\n[lib]\nname = "rg"\n\n[[bin]]\nname = "rg-cli"\n', "")).toEqual({ dir: "", name: "rg" });
    expect(cargoCrateOf('[workspace]\nmembers = ["crates/*"]\n', "")).toBeNull();
  });

  test("names packages as their registries do", () => {
    expect([packageOf("@sendgrid/mail/lib", "js"), packageOf("stripe", "js"), packageOf("fs", "js"), packageOf("github.com/gin-gonic/gin/render", "go")]).toEqual(["@sendgrid/mail", "stripe", null, "github.com/gin-gonic/gin"]);
    expect([packageOf("com.stripe.model.Customer", "jvm"), packageOf("dagger.Module", "jvm"), packageOf("kotlinx.coroutines.flow.*", "jvm"), packageOf("kotlin.collections.List", "jvm"), packageOf("android.os.Bundle", "jvm")]).toEqual(["com.stripe", "dagger", "kotlinx.coroutines", null, null]);
    expect([packageOf("tokio::sync::mpsc", "rust"), packageOf("::serde_json::Value", "rust"), packageOf("std::io", "rust"), packageOf("crate::orders", "rust")]).toEqual(["tokio", "serde_json", null, null]);
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

  test("leaves a request two endpoints in different files answer as well unmatched", () => {
    const twins = [{ file: "api/orders.ts", m: "POST", p: "/:id/refund" }, { file: "api/payments.ts", m: "POST", p: "/:id/refund" }];
    expect(endpointFor({ file: "web/client.ts", m: "POST", path: "/api/orders/:p/refund" }, twins)).toBeNull();
  });

  test("leaves a request with another method or no fixed part in common unmatched", () => {
    expect(ask("DELETE", "/api/orders")).toBeNull();
    expect(ask("GET", "/:p")).toBeNull();
    expect(ask("GET", "/tides")).toBeNull();
  });
});

describe("connect", () => {
  const file = (path, fields) => ({ path, repo: "", lang: "js", imports: [], routes: [], requests: [], mounts: [], prefix: "", defs: [], ...fields });
  const files = [
    file("api/app.ts", { imports: [{ spec: "./orders", names: ["orders"] }, { spec: "./payments", names: ["payments"] }], mounts: [{ prefix: "/api/orders", name: "orders" }, { prefix: "/api/payments", name: "payments" }] }),
    file("api/orders.ts", { routes: [{ m: "POST", p: "/:id/refund", line: 3 }] }),
    file("api/payments.ts", { routes: [{ m: "POST", p: "/:id/refund", line: 4 }] }),
    file("web/client.ts", { requests: [{ m: "POST", host: null, path: "/api/orders/:p/refund", line: 1 }] }),
  ];
  const resolve = (from, spec) => ({ files: [`api/${spec.slice(2)}.ts`], pkg: null });
  const connected = connect(files, resolve);

  test("puts each router's routes under the path it is mounted at", () => {
    expect(connected.routes.map((route) => `${route.m} ${route.p} ${route.file}`)).toEqual(["POST /api/orders/:id/refund api/orders.ts", "POST /api/payments/:id/refund api/payments.ts"]);
  });

  test("links a request to the endpoint under the right mount", () => {
    expect(connected.links.filter((link) => link.k === "http")).toEqual([{ a: "web/client.ts", b: "api/orders.ts", k: "http", w: 1, labels: ["POST /api/orders/:id/refund"] }]);
  });

  test("links a Java and Kotlin project's files through their imports", () => {
    const sources = {
      "app/src/main/kotlin/orders/OrderScreen.kt": "package com.shop.orders\n\nimport com.shop.billing.Invoice\nimport com.shop.orders.data.*\n\n@Composable\nfun OrderScreen() {}\n",
      "app/src/main/kotlin/orders/data/OrderRepository.kt": "package com.shop.orders.data\n\nclass OrderRepository\n",
      "billing/src/main/java/com/shop/billing/Invoice.java": "package com.shop.billing;\n\nimport com.stripe.model.Customer;\n\npublic class Invoice {}\n",
    };
    const files = Object.entries(sources).map(([path, text]) => ({ path, repo: "", ...extract(path, text) }));
    const project = connect(files, resolverFor(files));
    expect(project.links.map((link) => `${link.a} > ${link.b} ${link.labels.join(", ")}`.trim())).toEqual([
      "app/src/main/kotlin/orders/OrderScreen.kt > billing/src/main/java/com/shop/billing/Invoice.java Invoice",
      "app/src/main/kotlin/orders/OrderScreen.kt > app/src/main/kotlin/orders/data/OrderRepository.kt",
    ]);
    expect(project.files.find((file) => file.path.endsWith("Invoice.java")).packages).toEqual(["com.stripe"]);
  });

  test("links a Rust workspace's files through their modules and uses", () => {
    const sources = {
      "src/lib.rs": "pub mod orders;\nmod billing;\n",
      "src/orders.rs": "use crate::billing::charge;\nuse shop_core::Money;\nuse tokio::sync::mpsc;\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n}\n",
      "src/billing.rs": "pub fn charge() {}\n",
      "crates/core/src/lib.rs": "pub struct Money;\n",
    };
    const files = Object.entries(sources).map(([path, text]) => ({ path, repo: "", ...extract(path, text) }));
    const project = connect(files, resolverFor(files, { crates: [cargoCrateOf('[package]\nname = "shop"\n', ""), cargoCrateOf('[package]\nname = "shop-core"\n', "crates/core")] }));
    expect(project.links.map((link) => `${link.a} > ${link.b} ${link.labels.join(", ")}`)).toEqual([
      "src/lib.rs > src/orders.rs orders",
      "src/lib.rs > src/billing.rs billing",
      "src/orders.rs > src/billing.rs charge",
      "src/orders.rs > crates/core/src/lib.rs Money",
    ]);
    expect(project.files.find((file) => file.path === "src/orders.rs").packages).toEqual(["tokio"]);
  });
});

describe("scan, however large the project", () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), "chartroom-scan-")));
  const write = (project, path, text) => {
    mkdirSync(join(work, project, path, ".."), { recursive: true });
    writeFileSync(join(work, project, path), text);
  };
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  test("reads every code file of a project with more than 6000 of them", async () => {
    for (let index = 0; index < 6100; index += 1) write("many", `src/part-${index % 50}/file-${index}.ts`, `export const value${index} = ${index};\n`);
    write("many", "src/index.ts", 'import { value6099 } from "./part-49/file-6099";\nexport default value6099;\n');
    const read = await scan(join(work, "many"));
    expect(read.files).toHaveLength(6101);
    expect(read.links.map((one) => `${one.a} > ${one.b}`)).toEqual(["src/index.ts > src/part-49/file-6099.ts"]);
  });

  test("reads a code file however big it is, with its imports", async () => {
    write("big", "src/tables.ts", `import { port } from "./port";\nexport const rows = [\n${"  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],\n".repeat(16000)}];\n`);
    write("big", "src/port.ts", "export const port = 1;\n");
    const read = await scan(join(work, "big"));
    const tables = read.files.find((file) => file.path === "src/tables.ts");
    expect(tables.loc).toBe(16004);
    expect(read.links.map((one) => `${one.a} > ${one.b}`)).toEqual(["src/tables.ts > src/port.ts"]);
  });

  test("reads a project's own .d.ts files, but not those a build writes", async () => {
    write("typed", "src/deck.ts", 'import type { Deck } from "../types";\nexport const deck: Deck = { cards: [] };\n');
    write("typed", "types/index.d.ts", "export interface Deck { cards: string[] }\n");
    write("typed", "dist/index.d.ts", "export declare const deck: unknown;\n");
    write("typed", "src/app.min.js", "var a=1;\n");
    const read = await scan(join(work, "typed"));
    expect(read.files.map((file) => file.path).sort()).toEqual(["src/deck.ts", "types/index.d.ts"]);
    expect(read.links.map((one) => `${one.a} > ${one.b}`)).toEqual(["src/deck.ts > types/index.d.ts"]);
  });

  test("leaves out a file with a code file's name that is not text", async () => {
    write("binary", "src/real.ts", "export const real = true;\n");
    write("binary", "src/packed.js", "\0\0\0binary");
    expect((await scan(join(work, "binary"))).files.map((file) => file.path)).toEqual(["src/real.ts"]);
  });
});
