/**
 * Multi-Step Modal Wizard Manager
 *
 * Handles wizard lifecycle: navigation, validation, session persistence,
 * unsaved changes warning, and form submission.
 *
 * Usage:
 *   // Auto-initialization via data attributes
 *   <div class="modal" id="myWizard" data-wizard-name="user_profile" data-wizard-steps="5">
 *
 *   // Or manual initialization
 *   const wizard = new WizardManager('myWizard', { totalSteps: 5 });
 */
(function () {
  "use strict";

  class WizardManager {
    /**
     * Initialize a wizard instance
     * @param {string} modalId - The modal element ID
     * @param {Object} options - Configuration options
     */
    constructor(modalId, options = {}) {
      this.modal = document.getElementById(modalId);
      if (!this.modal) {
        console.error(`Wizard modal not found: ${modalId}`);
        return;
      }

      this.modalId = modalId;
      this.wizardName = this.modal.dataset.wizardName;
      this.wizardMode = this.modal.dataset.wizardMode || "create";

      // Parse context data from data attribute (used for delete wizards, etc.)
      this.wizardContext = {};
      if (this.modal.dataset.wizardContext) {
        try {
          this.wizardContext = JSON.parse(this.modal.dataset.wizardContext);
        } catch (e) {
          console.warn("Failed to parse wizard context:", e);
        }
      }

      this.options = {
        totalSteps: options.totalSteps || 1, // Will be updated from backend step_titles
        apiBase: options.apiBase || "/api/wizard/",
        onComplete: options.onComplete || null,
        onCancel: options.onCancel || null,
        ...options,
      };

      this.currentStep = 0;
      this.hasUnsavedChanges = false;
      this.stepData = {};
      this.visitedSteps = new Set([0]); // Track visited steps for click navigation
      this.bsModal = null;
      this.isLoading = false;

      this._initElements();
      this._bindEvents();
    }

    /**
     * Cache DOM element references
     */
    _initElements() {
      this.contentArea = this.modal.querySelector(".wizard-step-content");
      this.progressBar = this.modal.querySelector(".progress-bar");
      this.stepsContainer = this.modal.querySelector(".wizard-steps");
      this.stepIndicators = this.modal.querySelectorAll(".wizard-step-indicator");
      this.prevBtn = this.modal.querySelector(".wizard-prev-btn");
      this.nextBtn = this.modal.querySelector(".wizard-next-btn");
      this.submitBtn = this.modal.querySelector(".wizard-submit-btn");
      this.skipBtn = this.modal.querySelector(".wizard-skip-btn");
      this.saveCloseBtn = this.modal.querySelector(".wizard-save-close-btn");
      this.closeBtn = this.modal.querySelector(".wizard-close-btn");
      this.loadingSpinner = this.modal.querySelector(".wizard-loading");
    }

    /**
     * Bind event listeners
     */
    _bindEvents() {
      // Navigation buttons
      this.prevBtn?.addEventListener("click", () => this.previousStep());
      this.nextBtn?.addEventListener("click", () => this.nextStep());
      this.submitBtn?.addEventListener("click", () => this.submit());
      this.skipBtn?.addEventListener("click", () => this.skipStep());
      this.saveCloseBtn?.addEventListener("click", () => this.saveAndClose());
      this.closeBtn?.addEventListener("click", () => this._handleClose());

      // Step indicator click navigation
      this.stepIndicators.forEach((indicator, index) => {
        indicator.addEventListener("click", () => this.goToStep(index));
      });

      // Modal events
      this.modal.addEventListener("show.bs.modal", (event) => this._handleModalShow(event));
      this.modal.addEventListener("hidden.bs.modal", () => this._onHidden());

      // Track form changes via event delegation
      this.contentArea?.addEventListener("input", () => {
        this.hasUnsavedChanges = true;
      });

      // Beforeunload warning
      window.addEventListener("beforeunload", (e) => this._handleBeforeUnload(e));
    }

    /**
     * Handle modal show event - check if a specific start form was requested
     */
    _handleModalShow(event) {
      // Check if the button that triggered the modal has a start form attribute
      const triggerButton = event.relatedTarget;

      // Support edit_form (form class name) - backend resolves to step number
      const startForm = triggerButton?.dataset.wizardStartForm;

      if (startForm) {
        // Form class name - will be sent to backend for resolution
        this.requestedStartForm = startForm;
      } else {
        this.requestedStartForm = null;
      }

      this.start();
    }

    /**
     * Start the wizard - load first step (or requested form)
     */
    async start() {
      this.currentStep = 0;
      this.hasUnsavedChanges = false;
      this.stepData = {};
      this.visitedSteps = new Set([0]);

      // Clear previous content and show loading state immediately
      this._showLoading();

      try {
        // Build request body with optional context and start_form
        const requestBody = {};
        if (Object.keys(this.wizardContext).length > 0) {
          requestBody.context = this.wizardContext;
        }
        if (this.requestedStartForm) {
          requestBody.start_form = this.requestedStartForm;
        }

        const response = await fetch(
          `${this.options.apiBase}${this.wizardName}/start/`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRFToken": this._getCsrfToken(),
              "X-Requested-With": "XMLHttpRequest",
            },
            body: JSON.stringify(requestBody),
          }
        );

        const result = await response.json();

        if (result.success) {
          if (result.step_titles) {
            this._renderStepIndicators(result.step_titles);
          }

          // Backend renders the requested step directly, use its response
          const startStep = result.progress?.current || 0;
          this.currentStep = startStep;

          // Mark all steps up to the start step as visited
          for (let i = 0; i <= startStep; i++) {
            this.visitedSteps.add(i);
          }

          // Use the HTML from the response directly (no second request needed)
          this._setContent(result.html);
          this._updateProgress(result.progress);
          this._updateNavigation(startStep, result.is_skippable || false);

          // Reset after use
          this.requestedStartForm = null;
        } else {
          this._showError(result.error || "Failed to start wizard");
        }
      } catch (error) {
        console.error("Failed to start wizard:", error);
        this._showError("Failed to start wizard. Please try again.");
      }
    }

    /**
     * Navigate to next step after validation
     */
    async nextStep() {
      if (this.isLoading) return;

      const isValid = await this._validateCurrentStep();
      if (!isValid) return;

      // Mark current step as completed before advancing
      this.visitedSteps.add(this.currentStep);

      if (this.currentStep < this.options.totalSteps - 1) {
        this.currentStep++;
        // Mark new step as visited
        this.visitedSteps.add(this.currentStep);
        await this._loadStep(this.currentStep);
      }
    }

    /**
     * Navigate to previous step
     */
    async previousStep() {
      if (this.isLoading) return;

      // Save current step data before going back (no validation required)
      this._saveCurrentFormData();

      if (this.currentStep > 0) {
        this.currentStep--;
        await this._loadStep(this.currentStep);
      }
    }

    /**
     * Navigate directly to a specific step (via step indicator click)
     * @param {number} targetStep - Step index to navigate to
     */
    async goToStep(targetStep) {
      if (this.isLoading) return;

      // Can't go to current step
      if (targetStep === this.currentStep) return;

      // Can only go to visited steps
      if (!this.visitedSteps.has(targetStep)) return;

      const goingBackward = targetStep < this.currentStep;

      if (goingBackward) {
        // Going backward: save data without validation (like Previous button)
        this._saveCurrentFormData();
      } else {
        // Going forward: validate current step first
        const isValid = await this._validateCurrentStep();
        if (!isValid) return;

        // Mark current step as visited/completed since validation passed
        this.visitedSteps.add(this.currentStep);
      }

      // Navigate to target step
      this.currentStep = targetStep;
      await this._loadStep(targetStep);
    }

    /**
     * Skip current step (for steps with all optional fields)
     */
    async skipStep() {
      if (this.isLoading) return;

      // Save empty/current data and move to next step without validation
      this._saveCurrentFormData();

      if (this.currentStep < this.options.totalSteps - 1) {
        this.currentStep++;
        await this._loadStep(this.currentStep);
      }
    }

    /**
     * Save current form data to stepData without validation
     */
    _saveCurrentFormData() {
      const formData = this._getFormData();
      this.stepData[this.currentStep] = formData;
    }

    /**
     * Validate current step via AJAX
     * @returns {boolean} Whether validation passed
     */
    async _validateCurrentStep() {
      const formData = this._getFormData();
      this.isLoading = true;

      try {
        const response = await fetch(
          `${this.options.apiBase}${this.wizardName}/validate/`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRFToken": this._getCsrfToken(),
              "X-Requested-With": "XMLHttpRequest",
            },
            body: JSON.stringify({
              step: this.currentStep,
              data: formData,
            }),
          }
        );

        const result = await response.json();

        if (result.success) {
          this.stepData[this.currentStep] = formData;
          this._clearErrors();
          return true;
        } else {
          this._displayErrors(result.errors);
          return false;
        }
      } catch (error) {
        console.error("Validation error:", error);
        this._showError("Validation failed. Please try again.");
        return false;
      } finally {
        this.isLoading = false;
      }
    }

    /**
     * Load a specific step
     * @param {number} step - Step index (0-based)
     */
    async _loadStep(step) {
      this._updateStepIndicatorsOptimistic(step);

      try {
        const response = await fetch(
          `${this.options.apiBase}${this.wizardName}/step/${step}/`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRFToken": this._getCsrfToken(),
              "X-Requested-With": "XMLHttpRequest",
            },
            body: JSON.stringify({
              step_data: this.stepData,
            }),
          }
        );

        const result = await response.json();

        if (result.success) {
          this._setContent(result.html);
          this._updateProgress(result.progress);
          this._updateNavigation(step, result.is_skippable || false);
          this._populateStepData(step);
          this._exposeSessionData();
        } else {
          this._showError(result.error || "Failed to load step");
        }
      } catch (error) {
        console.error("Failed to load step:", error);
        this._showError("Failed to load step. Please try again.");
      }
    }

    /**
     * Submit the completed wizard
     */
    async submit() {
      if (this.isLoading) return;

      const isValid = await this._validateCurrentStep();
      if (!isValid) return;

      this.isLoading = true;

      try {
        const response = await fetch(
          `${this.options.apiBase}${this.wizardName}/submit/`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRFToken": this._getCsrfToken(),
              "X-Requested-With": "XMLHttpRequest",
            },
            body: JSON.stringify({
              all_data: this._mergeAllStepData(),
            }),
          }
        );

        const result = await response.json();

        if (result.success) {
          this.hasUnsavedChanges = false;
          this._hideModal();

          if (this.options.onComplete) {
            this.options.onComplete(result);
          }

          if (result.message) {
            // Could show a toast notification here
            console.log("Wizard completed:", result.message);
          }

          if (result.redirect_url) {
            window.location.href = result.redirect_url;
          } else {
            // Reload current page if no redirect specified
            window.location.reload();
          }
        } else {
          // Reload current step to show form with errors
          await this._loadStep(this.currentStep);
          // Then display the errors on the reloaded form
          this._displayErrors(result.errors || { __all__: [result.error] });
        }
      } catch (error) {
        console.error("Submit error:", error);
        // Reload step and show error
        await this._loadStep(this.currentStep);
        this._displayErrors({ __all__: ["Submission failed. Please try again."] });
      } finally {
        this.isLoading = false;
      }
    }

    /**
     * Save current step and close modal (for edit mode)
     */
    async saveAndClose() {
      if (this.isLoading) return;

      // Validate current step
      const isValid = await this._validateCurrentStep();
      if (!isValid) return;

      this.isLoading = true;

      try {
        // Submit the wizard with current data
        const response = await fetch(
          `${this.options.apiBase}${this.wizardName}/submit/`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRFToken": this._getCsrfToken(),
              "X-Requested-With": "XMLHttpRequest",
            },
            body: JSON.stringify({
              all_data: this._mergeAllStepData(),
            }),
          }
        );

        const result = await response.json();

        if (result.success) {
          this.hasUnsavedChanges = false;
          this._hideModal();

          if (this.options.onComplete) {
            this.options.onComplete(result);
          }

          if (result.message) {
            console.log("Changes saved:", result.message);
          }

          // Reload the current page to reflect changes
          window.location.reload();
        } else {
          // Show errors on current step
          this._displayErrors(result.errors || { __all__: [result.error] });
        }
      } catch (error) {
        console.error("Save error:", error);
        this._displayErrors({ __all__: ["Save failed. Please try again."] });
      } finally {
        this.isLoading = false;
      }
    }

    /**
     * Cancel the wizard - clears server session data
     */
    async cancel() {
      // Clear session data on server
      try {
        await fetch(`${this.options.apiBase}${this.wizardName}/cancel/`, {
          method: "POST",
          headers: {
            "X-CSRFToken": this._getCsrfToken(),
            "X-Requested-With": "XMLHttpRequest",
          },
        });
      } catch (error) {
        console.error("Cancel error:", error);
      }

      if (this.options.onCancel) {
        this.options.onCancel();
      }
    }

    /**
     * Get form data from current step
     * @returns {Object} Form field values
     */
    _getFormData() {
      const formData = {};
      const inputs = this.contentArea.querySelectorAll(
        "input, select, textarea"
      );

      inputs.forEach((input) => {
        if (!input.name) return;

        if (input.type === "checkbox") {
          formData[input.name] = input.checked;
        } else if (input.type === "radio") {
          if (input.checked) {
            formData[input.name] = input.value;
          }
        } else {
          formData[input.name] = input.value;
        }
      });

      return formData;
    }

    /**
     * Populate form fields with previously saved data
     * @param {number} step - Step index
     */
    _populateStepData(step) {
      const savedData = this.stepData[step];
      if (!savedData) return;

      Object.entries(savedData).forEach(([name, value]) => {
        const input = this.contentArea.querySelector(`[name="${name}"]`);
        if (!input) return;

        if (input.type === "checkbox") {
          input.checked = value;
        } else if (input.type === "radio") {
          const radio = this.contentArea.querySelector(
            `[name="${name}"][value="${value}"]`
          );
          if (radio) radio.checked = true;
        } else {
          input.value = value;
        }
      });
    }

    /**
     * Merge all step data into single object
     * @returns {Object} Merged form data
     */
    _mergeAllStepData() {
      const merged = {};
      Object.values(this.stepData).forEach((stepData) => {
        Object.assign(merged, stepData);
      });
      return merged;
    }

    /**
     * Expose merged session data to window for summary templates
     * 
     * This allows step templates (especially summary steps) to access
     * all collected wizard data without needing custom JS in each template.
     * 
     * Also dispatches a custom event so templates can react when data updates.
     */
    _exposeSessionData() {
      window.wizardSessionData = this._mergeAllStepData();
      
      // Dispatch event for templates that need to react to data changes
      document.dispatchEvent(new CustomEvent('wizardDataReady', {
        detail: { data: window.wizardSessionData }
      }));
    }

    /**
     * Get CSRF token from cookie
     * @returns {string} CSRF token
     */
    _getCsrfToken() {
      const name = "csrftoken";
      const cookies = document.cookie.split(";");
      for (let cookie of cookies) {
        cookie = cookie.trim();
        if (cookie.startsWith(name + "=")) {
          return cookie.substring(name.length + 1);
        }
      }
      return "";
    }

    /**
     * Render step indicators dynamically from backend step_titles
     * @param {Array<string>} stepTitles - Array of step titles from wizard class
     */
    _renderStepIndicators(stepTitles) {
      if (!this.stepsContainer || !stepTitles?.length) return;

      // Update total steps from backend
      this.options.totalSteps = stepTitles.length;

      // Clear existing indicators
      this.stepsContainer.innerHTML = "";

      // Create step indicators
      stepTitles.forEach((title, index) => {
        const indicator = document.createElement("div");
        indicator.className = `wizard-step-indicator${index === 0 ? " active" : ""}`;
        indicator.dataset.step = index;

        indicator.innerHTML = `
          <div class="step-circle">${index + 1}</div>
          <small class="step-title">${title}</small>
        `;

        // Add click handler for navigation
        indicator.addEventListener("click", () => this.goToStep(index));

        this.stepsContainer.appendChild(indicator);
      });

      // Update cached reference
      this.stepIndicators = this.stepsContainer.querySelectorAll(".wizard-step-indicator");
    }

    /**
     * Update step indicators immediately for instant visual feedback (optimistic UI)
     * Called before network request to eliminate perceived lag
     * @param {number} targetStep - The step being navigated to
     */
    _updateStepIndicatorsOptimistic(targetStep) {
      // Update progress bar immediately
      if (this.progressBar) {
        const percentage = ((targetStep + 1) / this.options.totalSteps) * 100;
        this.progressBar.style.width = `${percentage}%`;
        this.progressBar.setAttribute("aria-valuenow", percentage);
      }

      // Update step indicators immediately
      this.stepIndicators.forEach((indicator, index) => {
        indicator.classList.remove("active", "completed", "clickable");
        if (index < targetStep) {
          indicator.classList.add("completed", "clickable");
        } else if (index === targetStep) {
          indicator.classList.add("active");
        }
        // Mark visited steps as clickable
        if (this.visitedSteps.has(index) && index !== targetStep) {
          indicator.classList.add("clickable");
        }
      });
    }

    /**
     * Update progress bar and step indicators
     * @param {Object} progress - Progress info from server
     */
    _updateProgress(progress) {
      if (!progress) return;

      // Update progress bar
      if (this.progressBar) {
        const percentage = ((progress.current + 1) / progress.total) * 100;
        this.progressBar.style.width = `${percentage}%`;
        this.progressBar.setAttribute("aria-valuenow", percentage);
      }

      // Update step indicators
      this.stepIndicators.forEach((indicator, index) => {
        indicator.classList.remove("active", "completed", "clickable");
        if (index < progress.current) {
          indicator.classList.add("completed", "clickable");
        } else if (index === progress.current) {
          indicator.classList.add("active");
        }
        // Mark visited steps as clickable (except current)
        if (this.visitedSteps.has(index) && index !== progress.current) {
          indicator.classList.add("clickable");
        }
      });
    }

    /**
     * Update navigation button states
     * @param {number} step - Current step index
     * @param {boolean} isSkippable - Whether current step can be skipped
     */
    _updateNavigation(step, isSkippable = false) {
      // Previous button - disabled on first step
      if (this.prevBtn) {
        this.prevBtn.disabled = step === 0;
      }

      // Determine if we're in edit mode (has wizard context)
      const isEditMode = Object.keys(this.wizardContext).length > 0;
      const isLastStep = step === this.options.totalSteps - 1;

      // Show/hide Save & Close button in edit mode
      if (this.saveCloseBtn) {
        this.saveCloseBtn.classList.toggle("d-none", !isEditMode || isLastStep);
      }

      // Next button - hide on last step, or make it secondary in edit mode
      if (this.nextBtn) {
        this.nextBtn.classList.toggle("d-none", isLastStep);
        if (isEditMode) {
          this.nextBtn.classList.remove("btn-primary");
          this.nextBtn.classList.add("btn-outline-secondary");
        } else {
          this.nextBtn.classList.add("btn-primary");
          this.nextBtn.classList.remove("btn-outline-secondary");
        }
      }

      // Submit button - show on last step
      if (this.submitBtn) {
        this.submitBtn.classList.toggle("d-none", !isLastStep);
      }

      // Skip button - only show for skippable steps that aren't the last step
      if (this.skipBtn) {
        this.skipBtn.classList.toggle("d-none", !isSkippable || isLastStep);
      }
    }

    /**
     * Display field-level errors
     * @param {Object} errors - Field name to error messages mapping
     */
    _displayErrors(errors) {
      this._clearErrors();

      if (!errors) return;

      for (const [fieldName, messages] of Object.entries(errors)) {
        // Handle non-field errors
        if (fieldName === "__all__" || fieldName === "non_field_errors") {
          const errorDiv = document.createElement("div");
          errorDiv.className = "alert alert-danger wizard-form-error mb-3";
          errorDiv.textContent = Array.isArray(messages)
            ? messages[0]
            : messages;
          this.contentArea.insertBefore(errorDiv, this.contentArea.firstChild);
          continue;
        }

        const field = this.contentArea.querySelector(`[name="${fieldName}"]`);
        if (field) {
          field.classList.add("is-invalid");

          const errorDiv = document.createElement("div");
          errorDiv.className = "invalid-feedback wizard-field-error";
          errorDiv.textContent = Array.isArray(messages)
            ? messages[0]
            : messages;

          // Insert after the field or its wrapper
          const wrapper = field.closest(".mb-3") || field.parentElement;
          if (wrapper) {
            wrapper.appendChild(errorDiv);
          } else {
            field.insertAdjacentElement("afterend", errorDiv);
          }
        }
      }

      // Scroll to first error
      const firstError = this.contentArea.querySelector(".is-invalid");
      if (firstError) {
        firstError.scrollIntoView({ behavior: "smooth", block: "center" });
        firstError.focus();
      }
    }

    /**
     * Clear all error displays
     */
    _clearErrors() {
      this.contentArea
        .querySelectorAll(".is-invalid")
        .forEach((el) => el.classList.remove("is-invalid"));
      this.contentArea
        .querySelectorAll(".wizard-field-error, .wizard-form-error")
        .forEach((el) => el.remove());
    }

    /**
     * Show generic error message
     * @param {string} message - Error message
     */
    _showError(message) {
      const errorHtml = `
        <div class="alert alert-danger wizard-form-error">
          <i class="bi bi-exclamation-triangle me-2"></i>
          ${message}
        </div>
      `;
      this.contentArea.innerHTML = errorHtml;
    }

    /**
     * Set the step content directly
     * @param {string} html - HTML content to display
     */
    _setContent(html) {
      this.contentArea.innerHTML = html;
    }

    /**
     * Show loading spinner and clear previous content
     */
    _showLoading() {
      this.contentArea.innerHTML = `
        <div class="d-flex justify-content-center align-items-center py-5">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
        </div>
      `;
      // Reset step indicators to initial state
      if (this.stepsContainer) {
        this.stepsContainer.innerHTML = "";
      }
      // Reset progress bar
      if (this.progressBar) {
        this.progressBar.style.width = "0%";
      }
    }

    /**
     * Hide the modal
     */
    _hideModal() {
      if (!this.bsModal) {
        this.bsModal = bootstrap.Modal.getInstance(this.modal);
      }
      if (this.bsModal) {
        this.bsModal.hide();
      }
    }

    /**
     * Check if modal is currently open
     * @returns {boolean}
     */
    _isModalOpen() {
      return this.modal.classList.contains("show");
    }

    /**
     * Handle beforeunload event for unsaved changes warning
     * @param {BeforeUnloadEvent} e
     */
    _handleBeforeUnload(e) {
      if (this.hasUnsavedChanges && this._isModalOpen()) {
        e.preventDefault();
        e.returnValue = "You have unsaved changes in the wizard.";
        return e.returnValue;
      }
    }

    /**
     * Handle close button click
     */
    _handleClose() {
      this._hideModal();
    }

    /**
     * Cleanup when modal is hidden
     */
    _onHidden() {
      // Clear server session (fire and forget - don't block)
      this.cancel();

      // Reset wizard state
      this.currentStep = 0;
      this.stepData = {};
      this.visitedSteps = new Set([0]);
      this.hasUnsavedChanges = false;

      // Clear DOM content to prevent flash of old content on reopen
      if (this.contentArea) {
        this.contentArea.innerHTML = "";
      }
      if (this.stepsContainer) {
        this.stepsContainer.innerHTML = "";
      }
      if (this.progressBar) {
        this.progressBar.style.width = "0%";
      }
    }
  }

  // Auto-initialize wizards with data-wizard-auto-init attribute
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-wizard-auto-init]").forEach((modal) => {
      new WizardManager(modal.id);
    });
  });

  // Export for global access
  window.WizardManager = WizardManager;
})();
