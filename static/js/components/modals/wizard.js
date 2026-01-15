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
      this.options = {
        totalSteps: parseInt(this.modal.dataset.wizardSteps) || options.totalSteps || 5,
        apiBase: options.apiBase || "/api/wizard/",
        onComplete: options.onComplete || null,
        onCancel: options.onCancel || null,
        ...options,
      };

      this.currentStep = 0;
      this.hasUnsavedChanges = false;
      this.stepData = {};
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
      this.stepIndicators = this.modal.querySelectorAll(".wizard-step-indicator");
      this.prevBtn = this.modal.querySelector(".wizard-prev-btn");
      this.nextBtn = this.modal.querySelector(".wizard-next-btn");
      this.submitBtn = this.modal.querySelector(".wizard-submit-btn");
      this.skipBtn = this.modal.querySelector(".wizard-skip-btn");
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
      this.closeBtn?.addEventListener("click", () => this._handleClose());

      // Modal events
      this.modal.addEventListener("show.bs.modal", () => this.start());
      this.modal.addEventListener("hidden.bs.modal", () => this._onHidden());

      // Track form changes via event delegation
      this.contentArea?.addEventListener("input", () => {
        this.hasUnsavedChanges = true;
      });

      // Beforeunload warning
      window.addEventListener("beforeunload", (e) => this._handleBeforeUnload(e));
    }

    /**
     * Start the wizard - load first step
     */
    async start() {
      this.currentStep = 0;
      this.hasUnsavedChanges = false;
      this.stepData = {};

      this._showLoading();

      try {
        const response = await fetch(
          `${this.options.apiBase}${this.wizardName}/start/`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRFToken": this._getCsrfToken(),
              "X-Requested-With": "XMLHttpRequest",
            },
          }
        );

        const result = await response.json();

        if (result.success) {
          this.contentArea.innerHTML = result.html;
          this._updateProgress(result.progress);
          this._updateNavigation(0, result.is_skippable || false);
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

      if (this.currentStep < this.options.totalSteps - 1) {
        this.currentStep++;
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
      this._showLoading();

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
          this.contentArea.innerHTML = result.html;
          this._updateProgress(result.progress);
          this._updateNavigation(step, result.is_skippable || false);
          this._populateStepData(step);
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

      this._showLoading();
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
     * Cancel the wizard
     * @param {boolean} skipConfirm - If true, skip unsaved changes confirmation (used when already confirmed)
     */
    async cancel(skipConfirm = false) {
      if (this.hasUnsavedChanges && !skipConfirm) {
        const confirmed = confirm(
          "You have unsaved changes. Are you sure you want to cancel?"
        );
        if (!confirmed) return;
      }

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

      this.hasUnsavedChanges = false;
      this._hideModal();

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
        indicator.classList.remove("active", "completed");
        if (index < progress.current) {
          indicator.classList.add("completed");
        } else if (index === progress.current) {
          indicator.classList.add("active");
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

      // Next vs Submit button
      const isLastStep = step === this.options.totalSteps - 1;
      if (this.nextBtn) {
        this.nextBtn.classList.toggle("d-none", isLastStep);
      }
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
     * Show loading spinner
     */
    _showLoading() {
      this.contentArea.innerHTML = `
        <div class="d-flex justify-content-center align-items-center py-5">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
        </div>
      `;
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
      if (this.hasUnsavedChanges) {
        const confirmed = confirm(
          "You have unsaved changes. Are you sure you want to close?"
        );
        if (!confirmed) return;
      }
      // Skip confirmation in cancel() since we already confirmed above
      this.cancel(true);
    }

    /**
     * Cleanup when modal is hidden
     */
    _onHidden() {
      // Reset state if cancelled
      if (!this.hasUnsavedChanges) {
        this.currentStep = 0;
        this.stepData = {};
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
