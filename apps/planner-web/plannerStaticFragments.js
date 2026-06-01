(() => {
  /**
   * @param {Element} parent
   * @param {string} tagName
   * @param {string} text
   */
  function appendTextElement(parent, tagName, text) {
    const element = document.createElement(tagName);
    element.textContent = text;
    parent.append(element);
    return element;
  }

  /**
   * @param {string} id
   * @param {string} label
   */
  function createLimitField(id, label) {
    const field = document.createElement("label");
    field.className = "field";
    appendTextElement(field, "span", label);
    const input = document.createElement("input");
    input.id = id;
    input.type = "number";
    input.min = "1";
    input.step = "1";
    input.placeholder = "Optional";
    field.append(input);
    return field;
  }

  function createGlobalLimits() {
    const section = document.createElement("section");
    section.className = "drawer-card control-card";
    section.dataset.plannerSlot = "global-limits";
    section.hidden = true;

    const head = document.createElement("div");
    head.className = "drawer-head";
    const headCopy = document.createElement("div");
    appendTextElement(headCopy, "p", "Limits").className = "eyebrow";
    appendTextElement(headCopy, "h3", "Global caps");
    head.append(headCopy);

    const fields = document.createElement("div");
    fields.className = "form-grid two-up";
    fields.append(
      createLimitField("maxServices", "Max services"),
      createLimitField("maxResidentials", "Max residentials")
    );
    section.append(head, fields);
    return section;
  }

  /** @type {Record<string, () => HTMLElement>} */
  const fragments = {
    globalLimits: createGlobalLimits
  };

  for (const placeholder of document.querySelectorAll("[data-static-fragment]")) {
    const key = /** @type {HTMLElement} */ (placeholder).dataset.staticFragment;
    if (!key || !fragments[key]) continue;
    const fragment = fragments[key]();
    placeholder.parentElement?.insertBefore(fragment, placeholder);
    placeholder.parentElement?.removeChild(placeholder);
  }
})();
