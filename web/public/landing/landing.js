(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Simulador de WhatsApp (dados fictícios) ---------- */

  function dayMonth(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
  }

  function confirmation(name, dateOffset, hour, procedure) {
    return {
      type: "msg",
      dir: "in",
      time: "09:02",
      title: "Confirmação de consulta",
      text:
        "Olá, " + name + "! Aqui é a Central de Regulação, que organiza os atendimentos da Secretaria de Saúde.\n\n" +
        "Você tem uma consulta marcada:\n\nData: " + dayMonth(dateOffset) + " às " + hour + "\nProcedimento: " + procedure +
        "\nLocal: Unidade de Saúde Central\n\nPodemos confirmar sua presença?",
      buttons: ["Sim, vou comparecer", "Não poderei ir"],
    };
  }

  var SCENES = [
    [
      confirmation("Maria", 3, "08:30", "Ultrassonografia"),
      { type: "tap", button: 0 },
      { type: "msg", dir: "out", time: "09:04", text: "Sim, vou comparecer" },
      { type: "toast", tone: "blue", text: "Presença confirmada", sub: "Status atualizado na hora para a equipe" },
      {
        type: "msg",
        dir: "in",
        time: "08:00",
        text:
          "Olá, Maria! Lembrando da sua consulta amanhã:\n\nData: " + dayMonth(3) +
          " às 08:30\nProcedimento: Ultrassonografia\nLocal: Unidade de Saúde Central\n\nLeve documento com foto e o encaminhamento médico.",
      },
    ],
    [
      confirmation("Carlos", 4, "10:15", "Consulta em cardiologia"),
      { type: "tap", button: 1 },
      { type: "msg", dir: "out", time: "09:07", text: "Não poderei ir" },
      { type: "toast", tone: "red", text: "Vaga liberada 4 dias antes", sub: "O horário volta para a fila da unidade" },
    ],
    [
      {
        type: "msg",
        dir: "in",
        time: "09:20",
        text:
          "Olá, Ana! Aqui é a Central de Regulação, que organiza os atendimentos da Secretaria de Saúde.\n\n" +
          "Abriu uma vaga para Consulta em cardiologia:\n\nData: " + dayMonth(4) +
          " às 10:15\nLocal: Unidade de Saúde Central\n\nVocê tem interesse nesse horário?",
        buttons: ["Sim, quero a vaga", "Não, obrigado"],
      },
      { type: "tap", button: 0 },
      { type: "msg", dir: "out", time: "09:22", text: "Sim, quero a vaga" },
      { type: "toast", tone: "blue", text: "Horário reaproveitado", sub: "Mais um atendimento na mesma agenda" },
    ],
  ];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function buildMessage(step) {
    var msg = el("div", "msg " + step.dir + (step.buttons ? " has-buttons" : ""));
    if (step.title) msg.appendChild(el("span", "msg-title", step.title));
    msg.appendChild(document.createTextNode(step.text));
    if (step.buttons) {
      var box = el("div", "msg-buttons");
      step.buttons.forEach(function (label) {
        box.appendChild(el("span", null, label));
      });
      msg.appendChild(el("time", null, step.time));
      msg.appendChild(box);
    } else {
      msg.appendChild(el("time", null, step.time));
    }
    return msg;
  }

  function startSimulator() {
    var body = document.getElementById("wa-body");
    var toast = document.getElementById("wa-toast");
    if (!body || !toast) return;

    var lastTemplate = null;

    function wait(ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    }

    function showToast(step) {
      toast.className = "toast " + step.tone;
      toast.textContent = "";
      toast.appendChild(el("span", "toast-dot"));
      var text = el("div", null, step.text);
      text.appendChild(el("small", null, step.sub));
      toast.appendChild(text);
      requestAnimationFrame(function () {
        toast.classList.add("show");
      });
    }

    function appendMessage(step) {
      var msg = buildMessage(step);
      if (step.buttons) lastTemplate = msg;
      body.appendChild(msg);
      if (reducedMotion) {
        msg.classList.add("shown");
        return;
      }
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          msg.classList.add("shown");
        });
      });
    }

    async function typing(isOut) {
      var dots = el("div", "typing" + (isOut ? " out" : ""));
      dots.appendChild(el("span"));
      dots.appendChild(el("span"));
      dots.appendChild(el("span"));
      body.appendChild(dots);
      await wait(900);
      dots.remove();
    }

    async function playScene(scene) {
      for (var i = 0; i < scene.length; i++) {
        var step = scene[i];
        if (step.type === "msg") {
          await wait(step.dir === "in" ? 500 : 350);
          await typing(step.dir === "out");
          appendMessage(step);
          await wait(step.buttons ? 1600 : 900);
        } else if (step.type === "tap" && lastTemplate) {
          var buttons = lastTemplate.querySelectorAll(".msg-buttons span");
          if (buttons[step.button]) buttons[step.button].classList.add("tapped");
          await wait(500);
        } else if (step.type === "toast") {
          showToast(step);
          await wait(2200);
        }
      }
      await wait(1800);
    }

    function renderStatic(scene) {
      scene.forEach(function (step) {
        if (step.type === "msg") appendMessage(step);
        if (step.type === "toast") showToast(step);
      });
    }

    if (reducedMotion) {
      renderStatic(SCENES[1]);
      return;
    }

    (async function loop() {
      var index = 0;
      for (;;) {
        await playScene(SCENES[index]);
        body.classList.add("fading");
        toast.classList.remove("show");
        await wait(400);
        body.textContent = "";
        lastTemplate = null;
        body.classList.remove("fading");
        index = (index + 1) % SCENES.length;
      }
    })();
  }

  /* ---------- Fade ao rolar ---------- */

  function startReveal() {
    var items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || reducedMotion) {
      items.forEach(function (item) {
        item.classList.add("visible");
      });
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    items.forEach(function (item) {
      observer.observe(item);
    });
    // Rede de segurança: nada fica invisível se o observer não disparar.
    setTimeout(function () {
      items.forEach(function (item) {
        item.classList.add("visible");
      });
    }, 4000);
  }

  /* ---------- Dúvidas (acordeão) ---------- */

  function startFaq() {
    var items = document.querySelectorAll(".faq-item");
    items.forEach(function (item) {
      var button = item.querySelector(".faq-q");
      var answer = item.querySelector(".faq-a");
      button.addEventListener("click", function () {
        var opening = !item.classList.contains("open");
        items.forEach(function (other) {
          other.classList.remove("open");
          other.querySelector(".faq-q").setAttribute("aria-expanded", "false");
          other.querySelector(".faq-a").style.maxHeight = "";
        });
        if (opening) {
          item.classList.add("open");
          button.setAttribute("aria-expanded", "true");
          answer.style.maxHeight = answer.scrollHeight + "px";
        }
      });
    });
  }

  /* ---------- Formulário de contato ---------- */

  function startForm() {
    var form = document.getElementById("contact-form");
    var status = document.getElementById("form-status");
    if (!form || !status) return;

    function setStatus(text, kind) {
      status.textContent = text;
      status.className = "form-status" + (kind ? " " + kind : "");
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var payload = {
        name: String(data.get("name") || ""),
        organization: String(data.get("organization") || ""),
        role: String(data.get("role") || ""),
        phone: String(data.get("phone") || ""),
        email: String(data.get("email") || ""),
        message: String(data.get("message") || ""),
        website: String(data.get("website") || ""),
        consent: data.get("consent") === "on",
      };
      if (!payload.consent) {
        setStatus("É preciso autorizar o contato para enviar.", "err");
        return;
      }

      var button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      setStatus("Enviando…");
      try {
        var res = await fetch("/api/public/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        var body = await res.json().catch(function () {
          return {};
        });
        if (!res.ok) {
          setStatus(body.error || "Não foi possível enviar agora. Tente novamente.", "err");
          return;
        }
        form.reset();
        setStatus("Recebemos seu contato! Retornamos em breve.", "ok");
      } catch (err) {
        setStatus("Sem conexão. Verifique a internet e tente novamente.", "err");
      } finally {
        button.disabled = false;
      }
    });
  }

  startSimulator();
  startReveal();
  startFaq();
  startForm();
})();
