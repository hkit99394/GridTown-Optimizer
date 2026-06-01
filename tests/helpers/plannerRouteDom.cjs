const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..", "..");
const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source"]);

function dataKey(attributeName) {
  return attributeName.slice("data-".length).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function dataAttribute(key) {
  return `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

class TestTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.parentElement = null;
    this.textContent = text;
  }
}

class TestClassList {
  constructor(element) {
    this.element = element;
  }

  add(...names) {
    const classes = new Set(this.element.className.split(/\s+/).filter(Boolean));
    for (const name of names) classes.add(name);
    this.element.className = [...classes].join(" ");
  }

  remove(...names) {
    const removals = new Set(names);
    this.element.className = this.element.className
      .split(/\s+/)
      .filter((name) => name && !removals.has(name))
      .join(" ");
  }

  contains(name) {
    return this.element.className.split(/\s+/).includes(name);
  }

  toggle(name, enabled = !this.contains(name)) {
    if (enabled) this.add(name);
    else this.remove(name);
    return enabled;
  }
}

class TestElement {
  constructor(tagName, ownerDocument) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.localName = tagName.toLowerCase();
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.childNodes = [];
    this.attributes = new Map();
    this.classList = new TestClassList(this);
    this.listeners = new Map();
    this.style = {
      setProperty() {}
    };
    this.dataset = new Proxy(
      {},
      {
        set: (target, key, value) => {
          target[key] = String(value);
          this.attributes.set(dataAttribute(String(key)), String(value));
          return true;
        }
      }
    );
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
  }

  get id() {
    return this.getAttribute("id") ?? "";
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get className() {
    return this.getAttribute("class") ?? "";
  }

  set className(value) {
    this.setAttribute("class", value);
  }

  get href() {
    return this.getAttribute("href") ?? "";
  }

  set href(value) {
    this.setAttribute("href", value);
  }

  get rel() {
    return this.getAttribute("rel") ?? "";
  }

  set rel(value) {
    this.setAttribute("rel", value);
  }

  get src() {
    return this.getAttribute("src") ?? "";
  }

  set src(value) {
    this.setAttribute("src", value);
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this.replaceChildren(value ? new TestTextNode(String(value)) : []);
  }

  get innerHTML() {
    return this.textContent;
  }

  set innerHTML(value) {
    this.replaceChildren(value ? new TestTextNode(String(value)) : []);
  }

  get children() {
    return this.childNodes.filter((child) => child instanceof TestElement);
  }

  get firstElementChild() {
    return this.children[0] ?? null;
  }

  get nextElementSibling() {
    const siblings = this.parentElement?.children ?? [];
    const index = siblings.indexOf(this);
    return index === -1 ? null : (siblings[index + 1] ?? null);
  }

  get options() {
    return this.querySelectorAll("option");
  }

  setAttribute(name, value = "") {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name.startsWith("data-")) this.dataset[dataKey(name)] = stringValue;
    if (name === "value") this.value = stringValue;
    if (name === "checked") this.checked = true;
    if (name === "disabled") this.disabled = true;
    if (name === "hidden") this.hidden = true;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  prepend(...nodes) {
    for (const node of nodes.reverse()) this.insertBefore(node, this.firstElementChild);
  }

  appendChild(node) {
    const child = this.ownerDocument.coerceNode(node);
    this.insertBefore(child, null);
    this.ownerDocument.handleAppend(child);
    return child;
  }

  insertBefore(node, referenceNode) {
    const child = this.ownerDocument.coerceNode(node);
    child.parentElement?.removeChild(child);
    const index = referenceNode ? this.childNodes.indexOf(referenceNode) : -1;
    child.parentElement = this;
    if (index === -1) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) this.childNodes.splice(index, 1);
    node.parentElement = null;
    return node;
  }

  replaceChildren(...nodes) {
    for (const child of this.childNodes) child.parentElement = null;
    this.childNodes = [];
    this.append(...nodes.flat());
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target = this;
    for (const listener of this.listeners.get(event.type) ?? []) listener.call(this, event);
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent(new TestEvent("click", { bubbles: true }));
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  scrollIntoView() {}

  remove() {
    this.parentElement?.removeChild(this);
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelectorPart(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    return querySelectorAllFrom(this.children, selector);
  }
}

class TestButtonElement extends TestElement {}
class TestInputElement extends TestElement {}
class TestSelectElement extends TestElement {}

class TestDocument extends TestElement {
  constructor() {
    super("#document", null);
    this.ownerDocument = this;
    this.readyState = "loading";
    this.activeElement = null;
    this.documentElement = this.createElement("html");
    this.head = this.createElement("head");
    this.body = this.createElement("body");
    super.appendChild(this.documentElement);
    this.documentElement.append(this.head, this.body);
    this.executedScripts = [];
    this.loadedScripts = [];
    this.executeAppendedScripts = false;
  }

  createElement(tagName) {
    const lowerTag = tagName.toLowerCase();
    if (lowerTag === "button") return new TestButtonElement(lowerTag, this);
    if (lowerTag === "input") return new TestInputElement(lowerTag, this);
    if (lowerTag === "select") return new TestSelectElement(lowerTag, this);
    return new TestElement(lowerTag, this);
  }

  createTextNode(text) {
    return new TestTextNode(text);
  }

  coerceNode(node) {
    return typeof node === "string" ? this.createTextNode(node) : node;
  }

  handleAppend(node) {
    if (this.executeAppendedScripts && node instanceof TestElement && node.localName === "script" && node.src) {
      this.loadedScripts.push(node.src);
      this.runScript(node.src);
    }
  }

  runScript() {
    throw new Error("Script runner has not been attached.");
  }
}

class TestEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.defaultPrevented = false;
    this.target = null;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class TestMutationObserver {
  constructor(callback) {
    this.callback = callback;
  }

  observe() {}
  disconnect() {}
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function selectorParts(selector) {
  return selector.trim().split(/\s+/).filter(Boolean);
}

function querySelectorAllFrom(roots, selector) {
  let candidates = roots;
  for (const part of selectorParts(selector)) {
    candidates = candidates.flatMap((root) =>
      [root, ...descendants(root)].filter((element) => matchesSelectorPart(element, part))
    );
  }
  return candidates;
}

function matchesSelectorPart(element, part) {
  const structuralPart = part.replace(/\[[^\]]+\]/g, "");
  const tag = structuralPart.match(/^[a-zA-Z][\w-]*/)?.[0]?.toLowerCase();
  if (tag && element.localName !== tag) return false;

  const id = structuralPart.match(/#([\w-]+)/)?.[1];
  if (id && element.id !== id) return false;

  for (const [, className] of structuralPart.matchAll(/\.([\w-]+)/g)) {
    if (!element.classList.contains(className)) return false;
  }

  for (const [, rawName, quotedValue, bareValue] of part.matchAll(/\[([^\]=]+)(?:=(?:"([^"]*)"|([^\]]+)))?\]/g)) {
    const value = quotedValue ?? bareValue;
    const attribute = element.getAttribute(rawName);
    if (attribute === null) return false;
    if (value !== undefined && attribute !== value) return false;
  }

  return true;
}

function parseAttributes(source) {
  const attributes = [];
  for (const [, name, doubleQuoted, singleQuoted, bare] of source.matchAll(
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  )) {
    attributes.push([name, doubleQuoted ?? singleQuoted ?? bare ?? ""]);
  }
  return attributes;
}

function parseHtmlIntoDocument(html, document) {
  const stack = [document];
  for (const token of html.match(/<!--[\s\S]*?-->|<!doctype[\s\S]*?>|<\/?[^>]+>|[^<]+/gi) ?? []) {
    if (token.startsWith("<!--") || token.toLowerCase().startsWith("<!doctype")) continue;
    if (token.startsWith("</")) {
      stack.pop();
      continue;
    }
    if (token.startsWith("<")) {
      const tagMatch = token.match(/^<\s*([^\s/>]+)/);
      if (!tagMatch) continue;
      const tagName = tagMatch[1].toLowerCase();
      let element = tagName === "html" ? document.documentElement : tagName === "head" ? document.head : null;
      element = element ?? (tagName === "body" ? document.body : document.createElement(tagName));
      for (const [name, value] of parseAttributes(token.slice(tagMatch[0].length, token.lastIndexOf(">")))) {
        element.setAttribute(name, value);
      }
      if (!["html", "head", "body"].includes(tagName)) stack.at(-1).appendChild(element);
      if (!voidTags.has(tagName) && !token.endsWith("/>")) stack.push(element);
      continue;
    }
    if (token.trim()) stack.at(-1).appendChild(document.createTextNode(token));
  }
}

function extractPreviewBootScript(html) {
  const match = html.match(/<script\s+src="([^"]*plannerPreviewBoot\.js)"\s*><\/script>/);
  if (!match) throw new Error("Planner preview boot script was not found.");
  return match[1];
}

function extractDeferredScriptSources(html) {
  return [...html.matchAll(/<script\b(?=[^>]*\bdefer\b)[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)].map(
    (match) => match[1]
  );
}

function createLocalStorage() {
  const entries = new Map();
  return {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
    removeItem(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    }
  };
}

function createReadinessFetch() {
  return async (url) => ({
    ok: true,
    async json() {
      if (url === "/api/cp-sat/readiness") {
        return {
          ok: true,
          cpSat: {
            pythonExecutable: "/fake/python",
            ready: true
          }
        };
      }
      return { ok: true };
    }
  });
}

function createWindow(pathname) {
  const events = new Map();
  const document = new TestDocument();
  let timerId = 0;
  const window = {
    document,
    localStorage: createLocalStorage(),
    location: { pathname },
    URL: {
      createObjectURL() {
        return "blob:planner-route-smoke";
      },
      revokeObjectURL() {}
    },
    addEventListener(type, listener) {
      const listeners = events.get(type) ?? [];
      listeners.push(listener);
      events.set(type, listeners);
    },
    dispatchEvent(event) {
      for (const listener of events.get(event.type) ?? []) listener.call(window, event);
    },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    setInterval() {
      timerId += 1;
      return timerId;
    },
    clearInterval() {},
    setTimeout(callback) {
      timerId += 1;
      callback();
      return timerId;
    },
    clearTimeout() {},
    fetch: createReadinessFetch(),
    crypto: {
      getRandomValues(values) {
        values.fill(1);
        return values;
      }
    }
  };
  window.window = window;
  return { document, window };
}

function runPlannerRoute(pathname) {
  const html = fs.readFileSync(path.join(repoRoot, "apps", "planner-web", "index.html"), "utf8");
  const { document, window } = createWindow(pathname);
  const context = {
    window,
    document,
    Element: TestElement,
    HTMLElement: TestElement,
    HTMLButtonElement: TestButtonElement,
    HTMLInputElement: TestInputElement,
    HTMLSelectElement: TestSelectElement,
    Event: TestEvent,
    MutationObserver: TestMutationObserver,
    Date,
    Blob,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Math,
    Set,
    Map,
    Promise,
    URLSearchParams,
    fetch: window.fetch,
    localStorage: window.localStorage,
    requestAnimationFrame: window.requestAnimationFrame,
    setInterval: window.setInterval,
    clearInterval: window.clearInterval,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout
  };
  vm.createContext(context);
  document.runScript = (src) => {
    const source = fs.readFileSync(path.join(repoRoot, "apps", "planner-web", src.replace(/^\//, "")), "utf8");
    document.executedScripts.push(src);
    vm.runInContext(source, context, { filename: src });
  };

  parseHtmlIntoDocument(html, document);
  document.runScript(extractPreviewBootScript(html));
  for (const src of extractDeferredScriptSources(html)) document.runScript(src);
  document.readyState = "complete";
  document.executeAppendedScripts = true;
  document.dispatchEvent(new TestEvent("DOMContentLoaded"));
  window.dispatchEvent(new TestEvent("DOMContentLoaded"));

  return { document, window };
}

module.exports = {
  runPlannerRoute,
  TestElement,
  TestButtonElement,
  TestInputElement,
  TestSelectElement
};
