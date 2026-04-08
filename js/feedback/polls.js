(function() {
    function extractPollFromBody(body) {
        const regex = /<!-- poll: (.*?) -->/g;
        const match = regex.exec(body);
        if (match) { try { return JSON.parse(match[1]); } catch (e) { return null; } }
        return null;
    }
    
    function renderStaticPoll(container, pollData) {
        const pollDiv = document.createElement('div');
        pollDiv.className = 'poll card';
        pollDiv.innerHTML = `<h3>📊 ${GithubCore.escapeHtml(pollData.question)}</h3><div class="poll-options static">${pollData.options.map(opt => `<div class="poll-option"><span class="poll-option-text">${GithubCore.escapeHtml(opt)}</span></div>`).join('')}</div><p class="text-secondary small">(опрос будет доступен после публикации)</p>`;
        container.appendChild(pollDiv);
    }
    
    async function renderPoll(container, issueNumber, pollData) {
        const currentUser = GithubAuth.getCurrentUser();
        const comments = await GithubAPI.loadComments(issueNumber);
        const voteComments = comments.filter(c => /^!vote \d+$/.test(c.body.trim()));
        const voteCounts = pollData.options.map((_, idx) => voteComments.filter(c => c.body.trim() === `!vote ${idx}`).length);
        const totalVotes = voteCounts.reduce((s,v)=>s+v,0);
        const userVoted = currentUser ? voteComments.some(c => c.user.login === currentUser) : false;
        const pollDiv = document.createElement('div');
        pollDiv.className = 'poll card';
        pollDiv.dataset.issue = issueNumber;
        pollDiv.dataset.options = JSON.stringify(pollData.options);
        let html = `<h3>📊 ${GithubCore.escapeHtml(pollData.question)}</h3><div class="poll-options">`;
        pollData.options.forEach((option, index) => {
            const count = voteCounts[index], percent = totalVotes > 0 ? Math.round((count/totalVotes)*100) : 0;
            html += `<div class="poll-option" data-index="${index}"><div class="poll-option-text">${GithubCore.escapeHtml(option)}</div>`;
            if (!currentUser) {}
            else if (!userVoted) html += `<button class="button poll-vote-btn" data-option="${index}">Голосовать</button>`;
            else html += `<div class="progress-bar"><div style="width:${percent}%;">${percent}% (${count})</div></div>`;
            html += '</div>';
        });
        html += '</div>';
        if (!currentUser) html += '<p class="text-secondary small" style="margin-top:15px;"><i class="fas fa-info-circle"></i> Чтобы участвовать в опросе, <a href="#" id="poll-login-link">войдите в аккаунт</a>.</p>';
        else if (!userVoted) html += '<p class="text-secondary small" style="margin-top:10px;">Вы ещё не голосовали.</p>';
        pollDiv.innerHTML = html;
        container.innerHTML = '';
        container.appendChild(pollDiv);
        if (currentUser && !userVoted) {
            pollDiv.querySelectorAll('.poll-vote-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const optionIndex = btn.dataset.option;
                    btn.disabled = true;
                    try {
                        await GithubAPI.addComment(issueNumber, `!vote ${optionIndex}`);
                        if (window.UIUtils) UIUtils.showToast('Голос учтён', 'success');
                        await renderPoll(container, issueNumber, pollData);
                    } catch (err) {
                        if (window.UIUtils) UIUtils.showToast('Ошибка при голосовании', 'error');
                        await renderPoll(container, issueNumber, pollData);
                    }
                });
            });
        }
        const loginLink = pollDiv.querySelector('#poll-login-link');
        if (loginLink) {
            loginLink.addEventListener('click', (e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('github-login-requested')); });
        }
    }
    
    window.FeedbackPolls = {
        extractPollFromBody,
        renderPoll,
        renderStaticPoll
    };
})();