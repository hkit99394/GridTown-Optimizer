/**
 * @param {Window & { CityBuilderWorkbenchCatalog?: unknown }} globalObject
 */
(function attachPlannerWorkbenchCatalog(globalObject) {
  /**
   * @typedef {Record<string, any>} JsonObject
   * @typedef {JsonObject & { residentialTypes: JsonObject[], serviceTypes: JsonObject[] }} CatalogState
   * @typedef {{ escapeHtml: (value: unknown) => string, parseCatalogImportText: (text: unknown) => { services: JsonObject[] | null, residentials: JsonObject[] | null } }} CatalogHelpers
   * @typedef {{ updatePayloadPreview: () => void, updateSummary: () => void }} CatalogCallbacks
   * @typedef {{ state: CatalogState, elements: JsonObject, helpers: CatalogHelpers, callbacks: CatalogCallbacks }} CatalogOptions
   */

  /**
   * @param {CatalogOptions} options
   */
  function createPlannerWorkbenchCatalogController(options) {
    const { state, elements, helpers, callbacks } = options;
    const { escapeHtml, parseCatalogImportText } = helpers;
    const { updatePayloadPreview, updateSummary } = callbacks;

    function renderServiceTypes() {
      if (state.serviceTypes.length === 0) {
        elements.serviceList.innerHTML = `
          <div class="catalog-shell">
            <div class="catalog-empty">No service types yet. Add one to start the catalog.</div>
          </div>
        `;
        updateSummary();
        return;
      }

      const rows = state.serviceTypes
        .map(
          (entry, index) => `
        <tr>
          <td class="catalog-index">${index + 1}</td>
          <td><input type="text" value="${escapeHtml(entry.name)}" data-collection="serviceTypes" data-index="${index}" data-field="name" /></td>
          <td><input type="number" min="0" step="1" value="${escapeHtml(entry.bonus)}" data-collection="serviceTypes" data-index="${index}" data-field="bonus" /></td>
          <td><input type="text" value="${escapeHtml(entry.size)}" data-collection="serviceTypes" data-index="${index}" data-field="size" /></td>
          <td><input type="text" value="${escapeHtml(entry.effective)}" data-collection="serviceTypes" data-index="${index}" data-field="effective" /></td>
          <td><input type="number" min="0" step="1" value="${escapeHtml(entry.avail ?? "1")}" data-collection="serviceTypes" data-index="${index}" data-field="avail" /></td>
          <td class="catalog-action-cell"><button type="button" class="button ghost compact" data-action="remove-service" data-index="${index}">Remove</button></td>
        </tr>
      `
        )
        .join("");

      elements.serviceList.innerHTML = `
        <div class="catalog-shell">
          <table class="catalog-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Bonus</th>
                <th>Size</th>
                <th>Effective</th>
                <th>Avail</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
      updateSummary();
    }

    function renderResidentialTypes() {
      if (state.residentialTypes.length === 0) {
        elements.residentialList.innerHTML = `
          <div class="catalog-shell">
            <div class="catalog-empty">No residential types yet. Add one to start the catalog.</div>
          </div>
        `;
        updateSummary();
        return;
      }

      const rows = state.residentialTypes
        .map(
          (entry, index) => `
        <tr>
          <td class="catalog-index">${index + 1}</td>
          <td><input type="text" value="${escapeHtml(entry.name)}" data-collection="residentialTypes" data-index="${index}" data-field="name" /></td>
          <td><input type="text" value="${escapeHtml(entry.resident)}" data-collection="residentialTypes" data-index="${index}" data-field="resident" /></td>
          <td><input type="text" value="${escapeHtml(entry.size)}" data-collection="residentialTypes" data-index="${index}" data-field="size" /></td>
          <td><input type="number" min="0" step="1" value="${escapeHtml(entry.avail)}" data-collection="residentialTypes" data-index="${index}" data-field="avail" /></td>
          <td class="catalog-action-cell"><button type="button" class="button ghost compact" data-action="remove-residential" data-index="${index}">Remove</button></td>
        </tr>
      `
        )
        .join("");

      elements.residentialList.innerHTML = `
        <div class="catalog-shell">
          <table class="catalog-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Resident</th>
                <th>Size</th>
                <th>Avail</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
      updateSummary();
    }

    function importCatalogText() {
      try {
        const imported = parseCatalogImportText(elements.catalogImportText.value);
        if (imported.services) {
          state.serviceTypes = imported.services.map((entry) => ({ ...entry }));
          renderServiceTypes();
        }
        if (imported.residentials) {
          state.residentialTypes = imported.residentials.map((entry) => ({ ...entry }));
          renderResidentialTypes();
        }
        updatePayloadPreview();
        const importedParts = [
          imported.services ? `${imported.services.length} service rows` : "",
          imported.residentials ? `${imported.residentials.length} residential rows` : ""
        ].filter(Boolean);
        elements.catalogImportStatus.textContent = `Imported ${importedParts.join(" and ")}.`;
      } catch (error) {
        elements.catalogImportStatus.textContent =
          error instanceof Error ? error.message : "Failed to import pasted tables.";
      }
    }

    /**
     * @param {Event} event
     */
    function handleCatalogInput(event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const collectionName = target.dataset.collection;
      const index = Number(target.dataset.index);
      const field = target.dataset.field;
      if (!collectionName || !field || !Number.isInteger(index)) return;
      if (!Array.isArray(state[collectionName]) || !state[collectionName][index]) return;
      state[collectionName][index][field] = target.type === "checkbox" ? target.checked : target.value;
      updateSummary();
      updatePayloadPreview();
    }

    /**
     * @param {Event} event
     */
    function handleCatalogClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("[data-action]");
      if (!(button instanceof HTMLButtonElement)) return;
      const index = Number(button.dataset.index);
      if (!Number.isInteger(index)) return;

      if (button.dataset.action === "remove-service") {
        state.serviceTypes.splice(index, 1);
        renderServiceTypes();
      } else if (button.dataset.action === "remove-residential") {
        state.residentialTypes.splice(index, 1);
        renderResidentialTypes();
      } else {
        return;
      }

      updatePayloadPreview();
    }

    return Object.freeze({
      handleCatalogClick,
      handleCatalogInput,
      importCatalogText,
      renderResidentialTypes,
      renderServiceTypes
    });
  }

  const catalogGlobal = /** @type {Window & { CityBuilderWorkbenchCatalog?: unknown }} */ (globalObject);
  catalogGlobal.CityBuilderWorkbenchCatalog = Object.freeze({
    createPlannerWorkbenchCatalogController
  });
})(window);
