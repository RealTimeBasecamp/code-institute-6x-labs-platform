/**
 * Confirm Modal Component
 * Handles dynamic population of confirmation modal based on trigger button data attributes
 */

document.addEventListener('DOMContentLoaded', function() {
  const confirmModal = document.getElementById('confirmModal');

  if (!confirmModal) return;

  const modalTitle = confirmModal.querySelector('#confirmModalLabel');
  const modalBody = confirmModal.querySelector('#confirmModalBody');
  const modalForm = confirmModal.querySelector('#confirmModalForm');
  const modalButton = confirmModal.querySelector('#confirmModalButton');

  /**
   * Retrieves the CSRF token from cookies.
   * @returns {string} The CSRF token value
   */
  function getCsrfToken() {
    const name = 'csrftoken';
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
      const cookies = document.cookie.split(';');
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.substring(0, name.length + 1) === (name + '=')) {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
  }

  // Listen for modal show event
  confirmModal.addEventListener('show.bs.modal', function(event) {
    // Button that triggered the modal
    const button = event.relatedTarget;

    // Extract data from data attributes
    const title = button.getAttribute('data-modal-title') || 'Confirm Action';
    const body = button.getAttribute('data-modal-body') || 'Are you sure you want to proceed?';
    const action = button.getAttribute('data-modal-action');
    const method = button.getAttribute('data-modal-method') || 'POST';
    const confirmText = button.getAttribute('data-modal-confirm-text') || 'Confirm';
    const confirmClass = button.getAttribute('data-modal-confirm-class') || 'btn-primary';

    // Update modal content
    modalTitle.textContent = title;
    modalBody.innerHTML = body;
    modalForm.setAttribute('action', action);
    modalForm.setAttribute('method', method);
    modalButton.textContent = confirmText;

    // Update button styling
    modalButton.className = 'btn ' + confirmClass;
  });

  // Handle form submission with AJAX to stay on page
  modalForm.addEventListener('submit', function(e) {
    e.preventDefault();

    const formData = new FormData(modalForm);
    const action = modalForm.getAttribute('action');
    const method = modalForm.getAttribute('method');

    fetch(action, {
      method: method,
      body: formData,
      headers: {
        'X-CSRFToken': getCsrfToken(),
        'X-Requested-With': 'XMLHttpRequest',
      }
    })
    .then(response => {
      if (response.ok) {
        // Close modal
        bootstrap.Modal.getInstance(confirmModal).hide();

        // Reload page to show updated data
        window.location.reload();
      } else {
        alert('An error occurred. Please try again.');
      }
    })
    .catch(error => {
      console.error('Error:', error);
      alert('An error occurred. Please try again.');
    });
  });
});
