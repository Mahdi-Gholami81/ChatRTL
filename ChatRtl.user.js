// ==UserScript==
// @name         ChatRTL
// @namespace    http://chat.openai.com
// @namespace    http://deepseek.com
// @author       Mahdi Gholami
// @version      1.0.0
// @description  Fixes the direction of RTL languages in LLM's interface
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @match        https://chat.deepseek.com/*
// @match        https://claude.ai/*
// @match        https://chat.qwen.ai/*
// @grant        none
// ==/UserScript==

;(function() {
    "use strict";

    // Regex logic covering Arabic, Persian, Hebrew, etc.
    const RTL_REGEX = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    const styleId = 'deepseek-rtl-fix-style';

    // Inject custom CSS styles
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* General: Enforce RTL for matched text */
            .deepseek-rtl-applied,
            .deepseek-rtl-applied *,
            [data-message-author-role] .deepseek-rtl-applied,
            [data-message-author-role] .deepseek-rtl-applied * {
                direction: rtl !important;
                text-align: right !important;
            }

            /* Inherit direction for wrapper containers like markdown/prose */
            [data-message-author-role].deepseek-rtl-applied .markdown,
            [data-message-author-role].deepseek-rtl-applied .prose {
                direction: inherit !important;
                text-align: inherit !important;
            }

            /* Force LTR for Code Blocks and Preformatted text */
            pre, code, pre *, code *,
            [data-message-author-role] pre,
            [data-message-author-role] code,
            [data-message-author-role] pre *,
            [data-message-author-role] code *,
            .deepseek-rtl-applied pre,
            .deepseek-rtl-applied code {
                direction: ltr !important;
                text-align: left !important;
                unicode-bidi: embed !important;
            }

            /* Force LTR for KaTeX (Math formulas) */
            .katex-html,
            .katex-html *,
            .deepseek-katex-ltr {
                direction: ltr !important;
                text-align: left !important;
                unicode-bidi: embed !important;
            }

            .qwen-code-block, .qwen-code-block *, .code-block, .code-block *, [class*="code"] pre, [class*="code"] code {
                direction: ltr !important;
                text-align: left !important;
                unicode-bidi: embed !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Check node text and apply RTL class if needed
    function applyRTLToNode(node) {
        if (!node) return;
        let elem = null;

        if (node.nodeType === Node.TEXT_NODE) {
            elem = node.parentElement;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            elem = node;
        }
        if (!elem || elem.closest('.deepseek-rtl-applied')) return;

        const txt = elem.textContent || "";
        if (RTL_REGEX.test(txt)) {
            elem.classList.add('deepseek-rtl-applied');
            // Also tag parent markdown wrappers if necessary
            const md = elem.closest('.markdown, .prose, [data-message-author-role]');
            if (md && !md.classList.contains('deepseek-rtl-applied')) md.classList.add('deepseek-rtl-applied');
        }
    }

    // Efficiently scan DOM using TreeWalker
    function initialScan(root) {
        if (!root) root = document.body;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        let cur;
        while ((cur = walker.nextNode())) {
            applyRTLToNode(cur);
        }
    }

    // Recursive search for elements inside open Shadow Roots
    function findAllInShadowRoots(root, selector, results = []) {
        try {
            if (!root) return results;
            if (root.querySelectorAll) {
                root.querySelectorAll(selector).forEach(el => results.push(el));
            }
            const elems = root.querySelectorAll ? root.querySelectorAll('*') : [];
            elems.forEach(el => {
                if (el.shadowRoot) {
                    findAllInShadowRoots(el.shadowRoot, selector, results);
                }
            });
        } catch (e) {
            // Shadow root might be closed or inaccessible
        }
        return results;
    }

    // Fix direction for KaTeX math elements
    function fixKaTeX(root) {
        try {
            root = root || document;
            const normal = (root.querySelectorAll && Array.from(root.querySelectorAll('.katex-html'))) || [];
            const fromShadow = findAllInShadowRoots(root, '.katex-html');
            const all = [...new Set([...normal, ...fromShadow])];

            if (all.length === 0) return false;

            all.forEach(element => {
                element.setAttribute('dir', 'ltr');
                element.classList.add('deepseek-katex-ltr');
                element.style.direction = 'ltr';
                element.style.textAlign = 'left';

                // Ensure parent pre/code blocks are also LTR
                const pre = element.closest('pre, code');
                if (pre) {
                    pre.setAttribute('dir', 'ltr');
                    pre.style.direction = 'ltr';
                    pre.style.textAlign = 'left';
                }
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    // Retry mechanism for dynamic KaTeX rendering
    function scheduleKaTeXFix(root, attempts = 3, delay = 200) {
        if (attempts <= 0) return;
        const ok = fixKaTeX(root);
        if (!ok) {
            setTimeout(() => scheduleKaTeXFix(root, attempts - 1, delay), delay);
        }
    }

    // --- Initialization ---
    initialScan(document.body);
    scheduleKaTeXFix(document, 4, 250);

    // Observe DOM changes for new messages
    const observer = new MutationObserver((mutations) => {
        for (const mut of mutations) {
            if (mut.type === 'childList') {
                for (const nd of mut.addedNodes) {
                    applyRTLToNode(nd);
                    if (nd.nodeType === Node.ELEMENT_NODE) {
                        initialScan(nd);
                        scheduleKaTeXFix(nd, 3, 200);
                        // Check new shadow roots
                        if (nd.shadowRoot) scheduleKaTeXFix(nd.shadowRoot, 3, 200);
                    }
                }
            } else if (mut.type === 'characterData') {
                applyRTLToNode(mut.target);
                scheduleKaTeXFix(mut.target.parentElement, 2, 200);
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    console.debug('[RTL-Fix] initialized.');
})();