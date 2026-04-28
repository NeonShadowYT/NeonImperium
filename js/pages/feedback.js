/* feedback.css – идеальная обратная связь + модалки + адаптив */
.feedback-container{margin-top:24px}
.feedback-container .text-secondary{margin-bottom:20px}
.feedback-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px}
.feedback-header h2{margin:0;font-size:24px}
.feedback-header .button{min-width:160px;display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:var(--font-family)}
.feedback-tabs{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;justify-content:center}
.feedback-tab{background:var(--bg-inner-gradient);border:1px solid var(--border);color:var(--text-secondary);padding:8px 14px;border-radius:30px;font-size:14px;cursor:pointer;transition:all var(--transition);white-space:nowrap;font-family:var(--font-family)}
.feedback-tab:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
.feedback-tab.active{background:var(--accent);color:#fff;border-color:var(--accent)}
.feedback-form-wrapper{margin-bottom:30px}
.feedback-form{background:var(--bg-inner-gradient);border-radius:24px;padding:20px;border:1px solid var(--border);display:flex;flex-direction:column;gap:12px}
.feedback-input,.feedback-select,.feedback-textarea{width:100%;padding:12px 18px;background:var(--bg-primary);border:1px solid var(--border);border-radius:40px;color:var(--text-primary);font-family:var(--font-family);font-size:14px}
.feedback-select{appearance:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='white'><path d='M7 10l5 5 5-5z'/></svg>");background-repeat:no-repeat;background-position:right 15px center}
.feedback-textarea{border-radius:24px;min-height:100px;resize:vertical}
.preview-url-wrapper{display:flex;gap:8px;align-items:center;flex-wrap:nowrap}
.preview-url-input{flex:1;min-width:0}
.image-services-btn{background:var(--bg-inner-gradient);border:1px solid var(--border);color:var(--text-secondary);padding:10px 16px;border-radius:40px;cursor:pointer;font-size:14px;transition:all var(--transition);display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-family:var(--font-family);flex-shrink:0}
.image-services-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
.preview-thumbnail{margin-top:5px;max-width:200px;border-radius:12px;overflow:hidden;border:2px solid var(--accent);position:relative}
.preview-thumbnail img{width:100%;height:auto;display:block}
.preview-thumbnail .remove-preview{position:absolute;top:5px;right:5px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;transition:background var(--transition)}
.preview-thumbnail .remove-preview:hover{background:#f44336}
.editor-toolbar{display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap;padding:8px;background:var(--bg-card);border-radius:12px;border:1px solid var(--border)}
.editor-btn-group{display:flex;gap:3px;flex-wrap:wrap;padding:0 5px;border-right:1px solid var(--border)}
.editor-btn{background:var(--bg-inner-gradient);border:1px solid var(--border);color:var(--text-secondary);padding:6px 12px;border-radius:20px;cursor:pointer;font-size:13px;transition:all var(--transition);display:inline-flex;align-items:center;gap:4px;font-family:var(--font-family)}
.editor-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
.editor-toolbar .editor-btn-group:last-child{border-right:none}
.preview-area{background:var(--bg-primary);border-radius:16px;padding:20px;margin-top:10px;border:1px solid var(--border);overflow-x:auto;max-height:400px;overflow-y:auto;transition:opacity var(--transition)}
.preview-area h1,.preview-area h2,.preview-area h3,.preview-area h4{color:var(--text-primary);margin-top:1em;margin-bottom:.5em}
.preview-area h1{font-size:2em}.preview-area h2{font-size:1.5em}.preview-area h3{font-size:1.3em}.preview-area h4{font-size:1.1em}
.preview-area p{margin:.5em 0;line-height:1.6;color:var(--text-secondary)}
.preview-area blockquote{border-left:4px solid var(--accent);margin:1em 0;padding:.5em 1em;background:var(--bg-card);border-radius:8px}
.preview-area code{background:var(--bg-card-solid);padding:2px 4px;border-radius:4px;font-family:monospace}
.preview-area pre{background:var(--bg-card-solid);padding:1em;border-radius:8px;overflow-x:auto;border:1px solid var(--border)}.preview-area pre code{background:none;padding:0}
.preview-area table{border-collapse:collapse;width:100%;margin:1em 0}
.preview-area th,.preview-area td{border:1px solid var(--border);padding:8px 12px;text-align:left}.preview-area th{background:var(--bg-card)}
.preview-area img{max-width:100%;height:auto;border-radius:8px}
.preview-area details,.modal-body details,.feedback-item-details details{margin:0.5em 0;background:var(--bg-card);border-radius:12px;border:1px solid var(--border);overflow:hidden}
.preview-area summary,.modal-body summary,.feedback-item-details summary{padding:10px 16px;cursor:pointer;font-weight:700;color:var(--accent);background:var(--bg-inner-gradient);list-style:none;position:relative;transition:background var(--transition);border-bottom:1px solid transparent}
.preview-area summary:hover,.modal-body summary:hover,.feedback-item-details summary:hover{background:var(--bg-card-solid)}
.preview-area summary::before,.modal-body summary::before,.feedback-item-details summary::before{content:'▶';display:inline-block;margin-right:8px;transition:transform var(--transition);font-size:14px;color:var(--accent)}
.preview-area details[open] summary::before,.modal-body details[open] summary::before,.feedback-item-details details[open] summary::before{transform:rotate(90deg)}
.preview-area details>:not(summary),.modal-body details>:not(summary),.feedback-item-details details>:not(summary){padding:12px 16px;background:var(--bg-primary);border-top:1px solid var(--border)}
.markdown-body{overflow-x:auto}
.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4{color:var(--text-primary);margin-top:1em;margin-bottom:.5em}
.markdown-body h1{font-size:2em}.markdown-body h2{font-size:1.5em}.markdown-body h3{font-size:1.3em}.markdown-body h4{font-size:1.1em}
.markdown-body p{margin:.5em 0;line-height:1.6;color:var(--text-secondary)}
.markdown-body blockquote{border-left:4px solid var(--accent);margin:1em 0;padding:.5em 1em;background:var(--bg-card);border-radius:8px}
.markdown-body code{background:var(--bg-card-solid);padding:2px 4px;border-radius:4px;font-family:monospace}
.markdown-body pre{background:var(--bg-card-solid);padding:1em;border-radius:8px;overflow-x:auto;border:1px solid var(--border)}.markdown-body pre code{background:none;padding:0}
.markdown-body table{border-collapse:collapse;width:100%;margin:1em 0}
.markdown-body th,.markdown-body td{border:1px solid var(--border);padding:8px 12px;text-align:left}.markdown-body th{background:var(--bg-card)}
.markdown-body img{max-width:100%;height:auto;border-radius:8px}
.markdown-body details{margin:0.5em 0;background:var(--bg-card);border-radius:12px;border:1px solid var(--border);overflow:hidden}
.markdown-body summary{padding:10px 16px;cursor:pointer;font-weight:700;color:var(--accent);background:var(--bg-inner-gradient);list-style:none;position:relative;transition:background var(--transition);border-bottom:1px solid transparent}
.markdown-body summary:hover{background:var(--bg-card-solid)}
.markdown-body summary::before{content:'▶';display:inline-block;margin-right:8px;transition:transform var(--transition);font-size:14px;color:var(--accent)}
.markdown-body details[open] summary::before{transform:rotate(90deg)}
.markdown-body details>:not(summary){padding:12px 16px;background:var(--bg-primary);border-top:1px solid var(--border)}
blockquote.color-red{border-left-color:#f44336}blockquote.color-green{border-left-color:#4caf50}
.inline-icon{font-size:1.2em;vertical-align:middle;margin:0 2px}
.progress-bar{background:var(--bg-primary);border:1px solid var(--border);border-radius:20px;height:24px;overflow:hidden;margin:10px 0}
.progress-bar>div{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-light));color:#fff;font-size:12px;line-height:24px;text-align:center;white-space:nowrap;border-radius:20px;transition:width 0.3s}
.custom-card{background:var(--bg-card-gradient);border:1px solid var(--border);border-radius:16px;padding:16px;margin:10px 0;box-shadow:var(--shadow)}
.custom-card h4{margin:0 0 8px;color:var(--accent);font-size:18px}.custom-card p{margin:0;color:var(--text-secondary)}
.youtube-embed{position:relative;width:100%;padding-bottom:56.25%;margin:10px 0;background:#000;border-radius:12px;overflow:hidden}
.youtube-embed iframe{position:absolute;top:0;left:0;width:100%;height:100%;border-radius:12px;border:1px solid var(--border)}
.feedback-list{display:flex;flex-direction:column;gap:12px}
.feedback-item{background:var(--bg-inner-gradient);border-radius:20px;padding:16px;border:1px solid var(--border);transition:all var(--transition);cursor:pointer;position:relative}
.feedback-item:hover{border-color:var(--accent);transform:translateY(-2px)}
.feedback-item.expanded{border-color:var(--accent);background:var(--bg-card)}
.feedback-item-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:4px}
.feedback-item-title{font-size:16px;color:var(--text-primary);margin:0;font-weight:400}
.feedback-item-meta{display:flex;gap:6px;flex-wrap:wrap}
.feedback-label{padding:4px 10px;border-radius:30px;font-size:11px;font-weight:400;text-transform:uppercase;background:var(--bg-primary);color:var(--text-secondary);border:none}
.feedback-item-preview{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;color:var(--text-secondary);font-size:13px;line-height:1.4;margin:8px 0}
.feedback-item-footer{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text-secondary);border-top:1px solid var(--border);padding-top:10px;margin-top:6px}
.feedback-item-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-top:8px;border-top:1px solid var(--border)}
.feedback-item-actions .action-btn{background:var(--bg-inner-gradient);border:1px solid var(--border);color:var(--text-secondary);width:36px;height:36px;border-radius:50%;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:all var(--transition) ease;font-size:16px}
.feedback-item-actions .action-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent);transform:translateY(-2px);box-shadow:0 4px 10px rgba(58,168,201,.3)}
.feedback-item-actions .action-btn:active{transform:translateY(0)}
.feedback-item-details{margin-top:16px;border-top:1px solid var(--border);padding-top:16px}
.feedback-comments{margin-bottom:16px}
.comment{background:var(--bg-primary);border-radius:18px;padding:12px 16px;margin-bottom:8px;font-size:13px;border:1px solid var(--border);position:relative}
.comment-meta{display:flex;justify-content:space-between;margin-bottom:4px;font-size:11px;color:var(--text-secondary)}
.comment-author{font-weight:700;color:var(--accent)}
.comment-form{display:flex;flex-direction:row;align-items:center;gap:8px;margin-top:8px}
.comment-form .comment-input{flex:1;padding:10px 18px;background:var(--bg-primary);border:1px solid var(--border);border-radius:40px;color:var(--text-primary);font-size:13px;font-family:var(--font-family)}
.comment-form .button-group{display:flex;gap:8px;flex-shrink:0}
.comment-form .button-group button{padding:8px 18px;border-radius:40px;font-family:var(--font-family);cursor:pointer;border:none;transition:background var(--transition)}
.comment-form .comment-submit{background:var(--accent);color:#fff}.comment-form .comment-submit:hover{background:var(--accent-light)}
.comment-form .comment-editor-btn{background:var(--bg-inner-gradient);border:1px solid var(--border);color:var(--text-secondary)}.comment-form .comment-editor-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
.comment-form button:disabled{opacity:.5;pointer-events:none}
.loading-spinner{text-align:center;padding:30px;color:var(--text-secondary)}
.error-message{background:rgba(244,67,54,.1);border:1px solid #f44336;border-radius:20px;padding:20px;text-align:center;color:#f44336}
.login-prompt{background:var(--bg-inner-gradient);border-radius:24px;padding:30px 20px;text-align:center}
.login-prompt i{font-size:48px;color:var(--accent);margin-bottom:15px}
.login-prompt h3{margin:0 0 10px;font-size:18px}
.login-prompt p{margin-bottom:20px;font-size:14px;color:var(--text-secondary)}
.login-prompt .button{font-family:var(--font-family)}
.reactions-container{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0;padding:8px 0;min-height:36px}
.reactions-container:empty{display:none}
.reaction-button{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:var(--bg-primary);border:1px solid var(--border);border-radius:30px;font-size:13px;color:var(--text-secondary);cursor:pointer;transition:all var(--transition)}
.reaction-button:hover{background:var(--accent);color:#fff;border-color:var(--accent);transform:translateY(-2px)}
.reaction-button.active{background:var(--accent);color:#fff;border-color:var(--accent)}
.reaction-emoji{font-size:16px}.reaction-count{font-weight:700;min-width:18px;text-align:center}
.reaction-add-btn{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;background:var(--bg-primary);border:1px solid var(--border);border-radius:50%;color:var(--text-secondary);font-size:16px;cursor:pointer;transition:all var(--transition);padding:0 8px}
.reaction-add-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent);transform:translateY(-2px)}.reaction-add-btn span{line-height:1}
.reaction-menu{position:absolute;background:var(--bg-card);border:1px solid var(--border);border-radius:30px;padding:5px;display:flex;gap:5px;box-shadow:var(--shadow);z-index:10010}
.reaction-menu-btn{background:transparent;border:none;font-size:20px;cursor:pointer;padding:5px 10px;border-radius:20px;transition:background var(--transition)}.reaction-menu-btn:hover{background:var(--bg-inner-gradient)}
.modal-fullscreen{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.95);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
.modal-content-full{background:var(--bg-card);border-radius:24px;max-width:900px;width:100%;max-height:90vh;overflow-y:auto;padding:0;position:relative;border:1px solid var(--accent);display:flex;flex-direction:column}
.modal-header{padding:20px 30px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:var(--bg-inner-gradient);border-radius:24px 24px 0 0;position:sticky;top:0;z-index:10}
.modal-header h2{margin:0;font-size:24px;color:var(--accent);word-break:break-word;padding-right:20px}
.modal-header-spacer{flex:1}
.modal-close{background:var(--bg-inner-gradient);border:1px solid var(--border);color:var(--text-secondary);width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all var(--transition);font-size:20px;flex-shrink:0;margin-left:8px}
.modal-close:hover{background:var(--accent);color:#fff;border-color:var(--accent);transform:rotate(90deg)}
.modal-body{padding:30px;overflow-y:auto}
.modal-header-actions{display:flex;align-items:center;gap:8px;margin-left:auto;margin-right:8px}
.modal-header-actions .action-btn{background:var(--bg-inner-gradient);border:1px solid var(--border);color:var(--text-secondary);width:36px;height:36px;border-radius:50%;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:all var(--transition) ease;font-size:16px}
.modal-header-actions .action-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent);transform:translateY(-2px);box-shadow:0 4px 10px rgba(58,168,201,.3)}
.modal-header-actions .action-btn:active{transform:translateY(0)}
.no-tilt{transform:none!important;transition:none!important}.no-tilt .project-image{transform:none!important;transition:none!important}.no-tilt:hover{transform:translateY(-5px)!important}
.button:disabled{opacity:.5;cursor:not-allowed;pointer-events:none}
.poll{margin:20px 0}.poll h3{margin-bottom:15px;color:var(--accent)}
.poll-options{display:flex;flex-direction:column;gap:15px}.poll-option{display:flex;flex-direction:column;gap:5px}
.poll-option-text{font-size:14px;color:var(--text-primary)}.poll-option .button{align-self:flex-start}
.poll .progress-bar{width:100%;margin-top:5px}.poll .progress-bar>div{text-align:center;color:#fff;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,.5)}.poll .small{margin-top:10px;font-size:12px}
.comment-actions{position:absolute;top:8px;right:8px;display:flex;gap:5px;opacity:0;transition:opacity var(--transition)}.comment:hover .comment-actions{opacity:1}
.comment-actions button{background:var(--bg-inner-gradient);border:1px solid var(--border);color:var(--text-secondary);width:28px;height:28px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all var(--transition)}
.comment-actions button:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
.modal-header-actions .action-btn i.fa-bookmark{color:var(--accent)}
.bookmark-delete{transition:opacity var(--transition)}.project-card:hover .bookmark-delete{opacity:1}

/* ---- Новые стили редактора ---- */
.access-switch {
    display: inline-flex;
    background: var(--bg-primary);
    border-radius: 40px;
    border: 1px solid var(--border);
    padding: 4px;
}
.access-switch-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    padding: 8px 20px;
    border-radius: 40px;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
    font-family: var(--font-family);
    white-space: nowrap;
}
.access-switch-btn.active {
    background: var(--accent);
    color: #fff;
}
.access-switch-btn:hover:not(.active) {
    background: rgba(255,255,255,0.05);
}

.private-users-input {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 40px;
    padding: 8px 16px;
    color: var(--text-primary);
    font-family: var(--font-family);
    font-size: 14px;
    transition: border-color 0.2s;
}
.private-users-input:focus {
    border-color: var(--accent);
    outline: none;
}

.editor-split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    align-items: stretch;
    margin-top: 10px;
}
.editor-split-left,
.editor-split-right {
    min-height: 200px;
    overflow: auto;
    border-radius: 16px;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    padding: 12px;
}
.editor-split-left textarea {
    width: 100%;
    height: 100%;
    min-height: 100%;
    resize: none;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-family: monospace;
    font-size: 14px;
    line-height: 1.5;
    padding: 6px;
}
.editor-split-right {
    background: var(--bg-primary);
    padding: 16px;
    word-wrap: break-word;
    overflow: auto;
    contain: strict;
}

/* Адаптив для сплит-редактора */
@media (max-width: 700px) {
    .editor-split {
        grid-template-columns: 1fr;
        grid-template-rows: auto auto;
    }
    .editor-split-left,
    .editor-split-right {
        min-height: 150px;
    }
    .private-users-input {
        flex: none;
        width: 100%;
        margin-left: 0 !important;
    }
}