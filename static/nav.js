// Mobile nav: move mega-panel inside nav-links for proper dropdown flow
(function() {
  var panel = document.querySelector('.mega-panel');
  var links = document.querySelector('.nav-links');
  var trigger = document.querySelector('.mega-trigger');
  if (!panel || !links || !trigger) return;

  var originalParent = panel.parentNode;
  var originalNextSibling = panel.nextElementSibling;

  function handleLayout() {
    var isMobile = window.innerWidth <= 768;
    if (isMobile && panel.parentNode !== links) {
      trigger.insertAdjacentElement('afterend', panel);
    } else if (!isMobile && panel.parentNode === links) {
      if (originalNextSibling) {
        originalParent.insertBefore(panel, originalNextSibling);
      } else {
        originalParent.appendChild(panel);
      }
      panel.classList.remove('open');
      trigger.classList.remove('active');
    }
  }

  handleLayout();
  window.addEventListener('resize', handleLayout);
})();
