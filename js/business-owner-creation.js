(function initBusinessOwnerCreation(global) {
  "use strict";

  var clientInviteRequestInFlight = false;

  function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeBusinessOwnerInput(payload) {
    var safePayload = payload && typeof payload === "object" ? payload : {};
    return {
      businessName: normalizeText(safePayload.businessName),
      ownerName: normalizeText(safePayload.ownerName),
      ownerEmail: normalizeText(safePayload.ownerEmail)
    };
  }

  function normalizeUsername(value) {
    var text = normalizeText(value).toLowerCase();
    text = text.replace(/\s+/g, ".");
    text = text.replace(/[^a-z0-9._-]+/g, "");
    text = text.replace(/[._-]{2,}/g, function (match) {
      return match.replace(/\./g, ".").replace(/-/g, "-").replace(/_/g, "_");
    });
    text = text.replace(/^\.+|\.+$/g, "");
    text = text.replace(/^[-_]+|[-_]+$/g, "");
    return text;
  }

  function stripClientOverrideFields(payload) {
    var safePayload = payload && typeof payload === "object" ? payload : {};
    var stripped = {};

    Object.keys(safePayload).forEach(function (key) {
      var lowerKey = String(key).toLowerCase();
      if (lowerKey === "business_id" || lowerKey === "businessid" || lowerKey === "role" || lowerKey === "password" || lowerKey === "status" || lowerKey === "user_id" || lowerKey === "auth_user_id" || lowerKey === "userid" || lowerKey === "authuserid") {
        return;
      }
      stripped[key] = safePayload[key];
    });

    return stripped;
  }

  function normalizeClientAccountInput(payload) {
    var safePayload = stripClientOverrideFields(payload);
    var username = normalizeUsername(safePayload.username);
    return {
      firstName: normalizeText(safePayload.firstName),
      lastName: normalizeText(safePayload.lastName),
      email: normalizeText(safePayload.email),
      phone: normalizeText(safePayload.phone),
      username: username,
      temporaryPassword: typeof safePayload.temporaryPassword === "string" ? safePayload.temporaryPassword : "",
      confirmTemporaryPassword: typeof safePayload.confirmTemporaryPassword === "string" ? safePayload.confirmTemporaryPassword : ""
    };
  }

  function validateBusinessOwnerInput(payload) {
    var values = normalizeBusinessOwnerInput(payload);
    var errors = [];

    if (!values.businessName) {
      errors.push("Business name is required.");
    }

    if (!values.ownerName) {
      errors.push("Owner name is required.");
    }

    if (!values.ownerEmail) {
      errors.push("Owner email is required.");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.ownerEmail)) {
      errors.push("Owner email must be a valid email address.");
    }

    if (errors.length) {
      return {
        ok: false,
        errors: errors,
        values: values
      };
    }

    return {
      ok: true,
      values: values
    };
  }

  function validateClientAccountInput(payload) {
    var values = normalizeClientAccountInput(payload);
    var errors = [];

    if (!values.firstName) {
      errors.push("Client first name is required.");
    }

    if (!values.lastName) {
      errors.push("Client last name is required.");
    }

    if (!values.email) {
      errors.push("Client email is required.");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      errors.push("Client email must be a valid email address.");
    }

    if (!values.username) {
      errors.push("Client username is required.");
    } else if (values.username.length < 3 || values.username.length > 30 || !/^[A-Za-z0-9._-]+$/.test(values.username)) {
      errors.push("Client username may contain only letters, numbers, periods, underscores, and hyphens, and must be 3-30 characters long.");
    }

    if (!values.temporaryPassword || values.temporaryPassword.length < 8) {
      errors.push("Temporary password must be at least 8 characters long.");
    } else if (values.temporaryPassword.length > 72) {
      errors.push("Temporary password must be 8-72 characters long to meet Supabase Auth limits.");
    }

    if (values.temporaryPassword && values.confirmTemporaryPassword && values.temporaryPassword !== values.confirmTemporaryPassword) {
      errors.push("Temporary password and confirmation must match.");
    }

    if (errors.length) {
      return {
        ok: false,
        errors: errors,
        values: values
      };
    }

    return {
      ok: true,
      values: values
    };
  }

  async function createBusinessOwner(payload) {
    if (!global.supabaseClient || !global.supabaseClient.functions) {
      return {
        ok: false,
        message: "Authentication services are unavailable right now. Please try again later.",
        error: "supabase_functions_unavailable"
      };
    }

    var validation = validateBusinessOwnerInput(payload);
    if (!validation.ok) {
      return {
        ok: false,
        message: validation.errors[0],
        errors: validation.errors,
        values: validation.values
      };
    }

    try {
      var sessionResult = await global.supabaseClient.auth.getSession();
      var session = sessionResult && sessionResult.data ? sessionResult.data.session : null;

      if (!session || !session.user || !session.user.id) {
        return {
          ok: false,
          message: "Your session has expired. Please sign in again and try creating the business."
        };
      }

      var result = await global.supabaseClient.functions.invoke("create-business-owner", {
        body: validation.values
      });

      if (result && result.error) {
        var rawMessage = result.error && result.error.message ? result.error.message : "Unable to create the business owner account.";
        var httpStatus = result.error && typeof result.error.status === "number" ? result.error.status : "unknown";
        var errorMessage = /Failed to send a request to the Edge Function/i.test(rawMessage)
          ? "The business creation function is unavailable or your session is not valid. Please sign in again and reload the page."
          : "Business creation failed: HTTP " + String(httpStatus) + " — " + rawMessage;

        if (typeof console !== "undefined" && console.warn) {
          console.warn("[create-business-owner] invocation failed", {
            httpStatus: httpStatus,
            message: rawMessage
          });
        }

        return {
          ok: false,
          message: errorMessage,
          error: result.error
        };
      }

      var response = result && result.data ? result.data : null;
      if (!response || response.ok === false) {
        return {
          ok: false,
          message: response && response.message ? response.message : "Unable to create the business owner account.",
          error: response && response.error ? response.error : null
        };
      }

      return {
        ok: true,
        data: response
      };
    } catch (error) {
      return {
        ok: false,
        message: error && error.message ? error.message : "Unable to create the business owner account.",
        error: error
      };
    }
  }

  async function createBusinessClient(payload) {
    if (!global.supabaseClient || !global.supabaseClient.functions) {
      return {
        ok: false,
        message: "Authentication services are unavailable right now. Please try again later.",
        error: "supabase_functions_unavailable"
      };
    }

    var validation = validateClientAccountInput(payload);
    if (!validation.ok) {
      return {
        ok: false,
        message: validation.errors[0],
        errors: validation.errors,
        values: validation.values
      };
    }

    try {
      var sessionResult = await global.supabaseClient.auth.getSession();
      var session = sessionResult && sessionResult.data ? sessionResult.data.session : null;

      if (!session || !session.user || !session.user.id) {
        return {
          ok: false,
          message: "Your session has expired. Please sign in again and try creating the client account."
        };
      }

      var temporaryPassword = validation.values.temporaryPassword;
      console.log("[create-business-client diagnostic]", {
        passwordLength: temporaryPassword && typeof temporaryPassword.length === "number" ? temporaryPassword.length : null,
        passwordType: typeof temporaryPassword,
        sameValue: temporaryPassword === validation.values.temporaryPassword,
        over72: temporaryPassword && typeof temporaryPassword.length === "number" ? temporaryPassword.length > 72 : false
      });

      var result = await global.supabaseClient.functions.invoke("create-business-client", {
        body: {
          firstName: validation.values.firstName,
          lastName: validation.values.lastName,
          email: validation.values.email,
          phone: validation.values.phone,
          username: validation.values.username,
          temporaryPassword: validation.values.temporaryPassword,
          confirmTemporaryPassword: validation.values.confirmTemporaryPassword
        }
      });

      if (result && result.error) {
        var rawMessage = result.error && result.error.message ? result.error.message : "Unable to create the client account.";
        var httpStatus = result.error && typeof result.error.status === "number" ? result.error.status : "unknown";
        var responseBody = result && result.data ? result.data : null;
        var responseMessage = responseBody && responseBody.message ? responseBody.message : null;
        var bodyText = responseBody && typeof responseBody === "object" ? JSON.stringify(responseBody) : "";
        var errorMessage = "Client creation failed: HTTP " + String(httpStatus) + " — " + rawMessage + (responseMessage ? " | Response: " + responseMessage : "") + (bodyText && !responseMessage ? " | Body: " + bodyText : "");

        if (typeof console !== "undefined" && console.warn) {
          console.warn("[create-client] invocation failed", {
            httpStatus: httpStatus,
            message: rawMessage,
            response: responseBody,
            bodyText: bodyText
          });
        }

        return {
          ok: false,
          message: responseMessage || errorMessage,
          error: result.error,
          response: responseBody
        };
      }

      var response = result && result.data ? result.data : null;
      if (!response || response.ok === false) {
        var responseStatus = result && result.status ? result.status : "unknown";
        var responseMessage = response && response.message ? response.message : "Unable to create the client account.";
        var payloadError = response && response.error ? response.error : null;
        var statusMessage = "Client creation failed: HTTP " + String(responseStatus) + " — " + responseMessage;

        return {
          ok: false,
          message: responseMessage || statusMessage,
          error: payloadError,
          response: response
        };
      }

      return {
        ok: true,
        data: response
      };
    } catch (error) {
      return {
        ok: false,
        message: error && error.message ? error.message : "Unable to create the client account.",
        error: error
      };
    }
  }

  function getCreateBusinessModal() {
    return global.document ? global.document.getElementById("businessCreateModal") : null;
  }

  function getCreateBusinessButton() {
    return global.document ? global.document.getElementById("openCreateBusinessModal") : null;
  }

  function setFeedback(message, isError) {
    var feedback = global.document ? global.document.getElementById("createBusinessOwnerFeedback") : null;
    if (!feedback) {
      return;
    }

    feedback.textContent = message || "";
    feedback.classList.toggle("error", !!isError);
    feedback.classList.toggle("success", !isError && !!message);
  }

  function openCreateBusinessModal() {
    var modal = getCreateBusinessModal();
    if (!modal) {
      return;
    }

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    var firstInput = global.document.getElementById("businessCreateName");
    if (firstInput) {
      firstInput.focus();
    }
  }

  function closeCreateBusinessModal() {
    var modal = getCreateBusinessModal();
    if (!modal) {
      return;
    }

    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    setFeedback("", false);
    var form = global.document.getElementById("createBusinessOwnerForm");
    if (form) {
      form.reset();
    }
  }

  async function handleCreateBusinessOwnerSubmit(event) {
    event.preventDefault();

    if (!global.document) {
      return;
    }

    var form = event.target;
    var formData = new global.FormData(form);
    var payload = {
      businessName: formData.get("businessName") || "",
      ownerName: formData.get("ownerName") || "",
      ownerEmail: formData.get("ownerEmail") || ""
    };

    var submitButton = form.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Creating...";
    }
    setFeedback("", false);

    try {
      var result = await createBusinessOwner(payload);
      if (!result.ok) {
        setFeedback(result.message || "Unable to create the business owner account.", true);
        return;
      }

      var success = result.data || {};
      var summary = global.document.getElementById("businessCreationSuccessSummary");
      if (summary) {
        var businessLabel = success.businessName || payload.businessName;
        var ownerLabel = success.ownerName || payload.ownerName;
        var emailLabel = success.ownerEmail || payload.ownerEmail;
        var invitationStatus = success.invitationStatus || "Invitation setup required";

        summary.innerHTML = [
          '<h3>Business created successfully</h3>',
          '<p><strong>Business:</strong> ' + escapeHtml(businessLabel) + '</p>',
          '<p><strong>Owner:</strong> ' + escapeHtml(ownerLabel) + '</p>',
          '<p><strong>Login:</strong> <a href="mailto:' + encodeURIComponent(emailLabel) + '">' + escapeHtml(emailLabel) + '</a></p>',
          '<p><strong>Status:</strong> ' + escapeHtml(invitationStatus) + '</p>'
        ].join("");
      }

      setFeedback(success.message || "Business and owner account created successfully.", false);
      form.reset();

      var successState = global.document.getElementById("businessCreateSuccessState");
      if (successState) {
        successState.classList.remove("hidden");
      }

      var createSection = global.document.getElementById("businessCreateFormSection");
      if (createSection) {
        createSection.classList.add("hidden");
      }
    } catch (error) {
      setFeedback(error && error.message ? error.message : "Unable to create the business owner account.", true);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Create Business";
      }
    }
  }

  async function handleCreateBusinessClientSubmit(event) {
    event.preventDefault();

    if (!global.document) {
      return;
    }

    if (clientInviteRequestInFlight) {
      return;
    }

    var form = event.target;
    var formData = new global.FormData(form);
    var payload = {
      firstName: formData.get("clientFirstName") || "",
      lastName: formData.get("clientLastName") || "",
      email: formData.get("clientEmail") || "",
      phone: formData.get("clientPhone") || "",
      username: formData.get("clientUsername") || "",
      temporaryPassword: formData.get("clientTemporaryPassword") || ""
    };

    var submitButton = form.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Creating...";
    }

    var feedback = global.document.getElementById("createBusinessClientFeedback");
    if (feedback) {
      feedback.textContent = "";
      feedback.classList.remove("error", "success");
    }

    clientInviteRequestInFlight = true;

    try {
      var result = await createBusinessClient(payload);
      if (!result.ok) {
        if (feedback) {
          feedback.textContent = result.message || "Unable to invite the client.";
          feedback.classList.add("error");
        }
        return;
      }

      var success = result.data || {};
      if (feedback) {
        feedback.textContent = success.message || "Client account created successfully.";
        feedback.classList.add("success");
      }

      form.reset();
      var successDetails = global.document.getElementById("businessClientSuccessSummary");
      if (successDetails) {
        var clientName = success.clientName || payload.firstName + (payload.lastName ? " " + payload.lastName : "");
        var clientUsername = success.username || payload.username || "";
        var clientEmail = success.clientEmail || payload.email || "";

        successDetails.innerHTML = [
          '<h3>Client account created</h3>',
          '<p><strong>Name:</strong> ' + escapeHtml(clientName) + '</p>',
          '<p><strong>Username:</strong> ' + escapeHtml(clientUsername) + '</p>',
          '<p><strong>Email:</strong> ' + escapeHtml(clientEmail) + '</p>',
          '<p><strong>Next step:</strong> Share the login details with the client, including the temporary password, and ask them to sign in to change it.</p>'
        ].join("");
      }

      var successState = global.document.getElementById("businessClientSuccessState");
      if (successState) {
        successState.classList.remove("hidden");
      }

      var clientSection = global.document.getElementById("businessClientFormSection");
      if (clientSection) {
        clientSection.classList.add("hidden");
      }

      if (typeof global.loadOwnerClientDirectory === "function") {
        await global.loadOwnerClientDirectory();
      }
    } catch (error) {
      if (feedback) {
        feedback.textContent = error && error.message ? error.message : "Unable to invite the client.";
        feedback.classList.add("error");
      }
    } finally {
      clientInviteRequestInFlight = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Invite Client";
      }
    }
  }

  function initBusinessOwnerCreation() {
    if (!global.document) {
      return;
    }

    var button = getCreateBusinessButton();
    if (button) {
      button.addEventListener("click", openCreateBusinessModal);
    }

    var closeButtons = global.document.querySelectorAll("[data-close-business-create-modal]");
    closeButtons.forEach(function (element) {
      element.addEventListener("click", closeCreateBusinessModal);
    });

    var form = global.document.getElementById("createBusinessOwnerForm");
    if (form) {
      form.addEventListener("submit", handleCreateBusinessOwnerSubmit);
    }

    var clientForm = global.document.getElementById("createBusinessClientForm");
    if (clientForm) {
      clientForm.addEventListener("submit", handleCreateBusinessClientSubmit);
    }

    var successDoneButton = global.document.getElementById("businessCreateDoneButton");
    if (successDoneButton) {
      successDoneButton.addEventListener("click", function () {
        closeCreateBusinessModal();
        var successState = global.document.getElementById("businessCreateSuccessState");
        if (successState) {
          successState.classList.add("hidden");
        }
        var createSection = global.document.getElementById("businessCreateFormSection");
        if (createSection) {
          createSection.classList.remove("hidden");
        }
      });
    }

    var clientDoneButton = global.document.getElementById("businessClientDoneButton");
    if (clientDoneButton) {
      clientDoneButton.addEventListener("click", async function () {
        var modal = global.document.getElementById("businessClientModal");
        if (modal) {
          modal.classList.add("hidden");
          modal.setAttribute("aria-hidden", "true");
        }
        var successState = global.document.getElementById("businessClientSuccessState");
        if (successState) {
          successState.classList.add("hidden");
        }
        var formSection = global.document.getElementById("businessClientFormSection");
        if (formSection) {
          formSection.classList.remove("hidden");
        }
        var successSummary = global.document.getElementById("businessClientSuccessSummary");
        if (successSummary) {
          successSummary.innerHTML = "";
        }

        if (typeof global.loadOwnerClientDirectory === "function") {
          await global.loadOwnerClientDirectory();
        }
      });
    }

    var openClientModalButton = global.document.getElementById("openCreateBusinessClientModal");
    if (openClientModalButton) {
      openClientModalButton.addEventListener("click", function () {
        var modal = global.document.getElementById("businessClientModal");
        if (modal) {
          modal.classList.remove("hidden");
          modal.setAttribute("aria-hidden", "false");
          var firstInput = global.document.getElementById("businessClientFirstName");
          if (firstInput) {
            firstInput.focus();
          }
        }
      });
    }

    var closeClientButtons = global.document.querySelectorAll("[data-close-business-client-modal]");
    closeClientButtons.forEach(function (element) {
      element.addEventListener("click", function () {
        if (clientInviteRequestInFlight) {
          return;
        }
        var modal = global.document.getElementById("businessClientModal");
        if (modal) {
          modal.classList.add("hidden");
          modal.setAttribute("aria-hidden", "true");
        }
        var form = global.document.getElementById("createBusinessClientForm");
        if (form) {
          form.reset();
        }
      });
    });
  }

  global.DasherLabBusinessOwnerCreation = {
    validateBusinessOwnerInput: validateBusinessOwnerInput,
    normalizeBusinessOwnerInput: normalizeBusinessOwnerInput,
    validateClientAccountInput: validateClientAccountInput,
    normalizeClientAccountInput: normalizeClientAccountInput,
    createBusinessOwner: createBusinessOwner,
    createBusinessClient: createBusinessClient,
    initBusinessOwnerCreation: initBusinessOwnerCreation,
    openCreateBusinessModal: openCreateBusinessModal,
    closeCreateBusinessModal: closeCreateBusinessModal
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initBusinessOwnerCreation);
    } else {
      initBusinessOwnerCreation();
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      normalizeBusinessOwnerInput: normalizeBusinessOwnerInput,
      validateBusinessOwnerInput: validateBusinessOwnerInput,
      normalizeClientAccountInput: normalizeClientAccountInput,
      validateClientAccountInput: validateClientAccountInput,
      isPlatformAdminRole: function (value) {
        return typeof value === "string" && ["admin", "platform_admin", "super_admin"].includes(value.toLowerCase());
      },
      isOwnerRole: function (value) {
        return typeof value === "string" && value.toLowerCase() === "owner";
      },
      isClientRole: function (value) {
        return typeof value === "string" && value.toLowerCase() === "client";
      },
      stripClientOverrideFields: stripClientOverrideFields,
      normalizeClientAccountInput: normalizeClientAccountInput,
      normalizeUsername: normalizeUsername
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
