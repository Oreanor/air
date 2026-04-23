export interface I18n {
  btnSend: string
  btnStop: string
  btnPreview: string
  btnClear: string
  btnAdd: string
  btnCommit: string
  btnPush: string
  modelLabel: string
  modelAuto: string
  branchNew: string
  branchPlaceholder: string
  emptyTitle: string
  emptyHint: string
  placeholder: string
  placeholderStreaming: string
  msgGitProgress: (op: 'add' | 'commit' | 'push') => string
  msgGitAdded: string
  msgGitCommitted: (msg?: string) => string
  msgGitPushed: (msg?: string) => string
  msgGitError: (err: string) => string
  msgNpmStarted: (cmd: string) => string
  msgDevWaiting: (ports: string) => string
  msgDevReady: (url: string) => string
  msgDevTimeout: string
  noWorkspaceHint: string
  scopeLabelFile: string
  scopeLabelProject: string
  scopePromptFile: (p: string) => string
  scopePromptFolder: (p: string) => string
  scopePromptProject: string
  quickPromptTooltip: string
  quickRefactorLabel: string
  quickTestsLabel: string
  quickFixLabel: string
  quickRefactorPrompt: string
  quickTestsPrompt: string
  quickFixPrompt: string
  quickActionLabel: string
  quickActionWith: string
  codeLinesLabel: (n: number) => string
  codeCopyBtn: string
  removeElement: string
  newPromptOption: string
  newPromptLabelPlaceholder: string
  newPromptBoilerplate: string
  newPromptSave: string
  newPromptCancel: string
  modeAction: string
  modeTask: string
  scheduleConfirm: (dt: string) => string
  calendarToggle: string
  calendarNoTasks: string
  calendarWeekdays: string[]
}

const en: I18n = {
  btnSend: 'Send',
  btnStop: '⏹ Stop',
  btnPreview: '⬡ Preview',
  btnClear: '✕ Clear',
  btnAdd: '＋ Add',
  btnCommit: '✓ Commit',
  btnPush: '⬆ Push',
  modelLabel: 'Model',
  modelAuto: '⚡ Auto',
  branchNew: '＋ New branch…',
  branchPlaceholder: 'branch name',
  emptyTitle: 'Kludge Code is ready',
  emptyHint: 'Enter — send · Shift+Enter — new line',
  placeholder: 'Write a message…',
  placeholderStreaming: 'Generating… press Stop to edit',
  msgGitProgress: op => ({ add: '⏳ Running `git add -A`…', commit: '⏳ Running add + commit…', push: '⏳ Running add + commit + push…' }[op]),
  msgGitAdded: '✓ Staged all changes (`git add -A`)',
  msgGitCommitted: msg => msg ? `✓ Committed: "${msg}"` : '✓ Committed',
  msgGitPushed: msg => msg ? `✓ Committed "${msg}" and pushed to remote` : '✓ Pushed to remote',
  msgGitError: err => `⚠ Git: ${err}`,
  msgNpmStarted: cmd => `▶ Running \`${cmd}\`…`,
  msgDevWaiting: ports => `🚀 Started \`npm run dev\`, waiting for server… (ports: ${ports})`,
  msgDevReady: url => `🚀 Server is up → ${url} · opening preview`,
  msgDevTimeout: '⚠ Server not found after 60s — open preview manually (⬡)',
  noWorkspaceHint: 'Open a folder to use npm and git tools',
  scopeLabelFile: 'File',
  scopeLabelProject: 'Project',
  scopePromptFile: p => `\n\nScope: file \`${p}\` only.`,
  scopePromptFolder: p => `\n\nScope: folder \`${p}\` only.`,
  scopePromptProject: '\n\nScope: entire project.',
  quickPromptTooltip: 'Send quick prompt',
  quickRefactorLabel: 'Refactor',
  quickTestsLabel: 'Tests',
  quickFixLabel: 'Fix errors',
  quickRefactorPrompt: 'Refactor the open file: check for compliance with project conventions, identify and fix antipatterns, bad practices, duplicated code, unused variables and imports, potential memory leaks, and SOLID violations. Provide specific recommendations with explanations. Do not break existing logic.',
  quickTestsPrompt: 'Check the test coverage of the open file. Write missing tests to bring coverage to 80–90%. Cover edge cases, error scenarios, and main execution paths. Use the existing test style and framework in the project. Do not remove existing tests.',
  quickFixPrompt: 'Find and fix all errors in the open file: TypeScript errors, linter errors, logic errors, potential runtime exceptions, incorrect types, async/await issues, and any other problems. For each fix, briefly explain the reason.',
  quickActionLabel: 'Action',
  quickActionWith: 'with',
  codeLinesLabel: n => `${n} lines`,
  codeCopyBtn: 'copy',
  removeElement: 'Remove',
  newPromptOption: '＋ New action…',
  newPromptLabelPlaceholder: 'Action name, e.g. "Security audit"',
  newPromptBoilerplate: 'Check the open file for [describe what to look for, e.g. "security issues"]. For each finding explain why it is a problem and show a fix. Do not change code unrelated to the task.',
  newPromptSave: 'Save',
  newPromptCancel: 'Cancel',
  modeAction: 'Permanent',
  modeTask: 'One-time',
  scheduleConfirm: dt => `⏰ Scheduled for ${dt}`,
  calendarToggle: '📅 Schedule',
  calendarNoTasks: 'No tasks for this day',
  calendarWeekdays: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
}

const ru: I18n = {
  btnSend: 'Отправить',
  btnStop: '⏹ Стоп',
  btnPreview: '⬡ Превью',
  btnClear: '✕ Очистить',
  btnAdd: '＋ Add',
  btnCommit: '✓ Commit',
  btnPush: '⬆ Push',
  modelLabel: 'Модель',
  modelAuto: '⚡ Авто',
  branchNew: '＋ Новая ветка…',
  branchPlaceholder: 'имя ветки',
  emptyTitle: 'Kludge Code готов к работе',
  emptyHint: 'Enter — отправить · Shift+Enter — перенос строки',
  placeholder: 'Напиши сообщение…',
  placeholderStreaming: 'Генерация… нажми Стоп чтобы изменить запрос',
  msgGitProgress: op => ({ add: '⏳ Выполняю `git add -A`…', commit: '⏳ Выполняю add + commit…', push: '⏳ Выполняю add + commit + push…' }[op]),
  msgGitAdded: '✓ Добавил все изменения в индекс (`git add -A`)',
  msgGitCommitted: msg => msg ? `✓ Закоммитил: «${msg}»` : '✓ Закоммитил',
  msgGitPushed: msg => msg ? `✓ Закоммитил «${msg}» и запушил на remote` : '✓ Запушил на remote',
  msgGitError: err => `⚠ Git: ${err}`,
  msgNpmStarted: cmd => `▶ Запускаю \`${cmd}\`…`,
  msgDevWaiting: ports => `🚀 Запустил \`npm run dev\`, жду сервер… (порты: ${ports})`,
  msgDevReady: url => `🚀 Сервер поднялся → ${url} · открываю превью`,
  msgDevTimeout: '⚠ Сервер не обнаружен за 60 сек — открой превью вручную (⬡)',
  noWorkspaceHint: 'Откройте папку, чтобы использовать npm и git',
  scopeLabelFile: 'Файл',
  scopeLabelProject: 'Проект',
  scopePromptFile: p => `\n\nОбласть: только файл \`${p}\`.`,
  scopePromptFolder: p => `\n\nОбласть: только папка \`${p}\`.`,
  scopePromptProject: '\n\nОбласть: весь проект.',
  quickPromptTooltip: 'Отправить быстрый запрос',
  quickRefactorLabel: 'Рефактор',
  quickTestsLabel: 'Тесты',
  quickFixLabel: 'Фикс ошибок',
  quickRefactorPrompt: 'Проведи рефакторинг открытого файла: проверь соответствие правилам проекта, найди и исправь антипаттерны, плохие практики, дублирующийся код, неиспользуемые переменные и импорты, потенциальные утечки памяти, нарушения принципов SOLID и чистого кода. Предложи конкретные улучшения с объяснением причин. Не ломай существующую логику.',
  quickTestsPrompt: 'Проверь покрытие тестами открытого файла. Напиши недостающие тесты, чтобы довести покрытие до 80–90%. Покрой граничные случаи, ошибочные сценарии и основные пути выполнения. Используй уже существующий стиль и фреймворк тестов в проекте. Не удаляй существующие тесты.',
  quickFixPrompt: 'Найди и исправь все ошибки в открытом файле: TypeScript-ошибки, ошибки линтера, логические ошибки, потенциальные runtime-исключения, неправильные типы, некорректную обработку async/await и любые другие проблемы. Для каждого исправления кратко объясни причину.',
  quickActionLabel: 'Действие',
  quickActionWith: 'с',
  codeLinesLabel: n => `${n} строк`,
  codeCopyBtn: 'копировать',
  removeElement: 'Убрать',
  newPromptOption: '＋ Новое действие…',
  newPromptLabelPlaceholder: 'Название действия, напр. «Аудит безопасности»',
  newPromptBoilerplate: 'Проверь открытый файл на [опиши что искать, напр. «уязвимости»]. Для каждой находки объясни в чём проблема и покажи исправление. Не трогай код, не относящийся к задаче.',
  newPromptSave: 'Сохранить',
  newPromptCancel: 'Отмена',
  modeAction: 'Постоянный',
  modeTask: 'Одноразовый',
  scheduleConfirm: dt => `⏰ Запланировано на ${dt}`,
  calendarToggle: '📅 Расписание',
  calendarNoTasks: 'Задач нет',
  calendarWeekdays: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
}

const pt: I18n = {
  btnSend: 'Enviar',
  btnStop: '⏹ Parar',
  btnPreview: '⬡ Preview',
  btnClear: '✕ Limpar',
  btnAdd: '＋ Add',
  btnCommit: '✓ Commit',
  btnPush: '⬆ Push',
  modelLabel: 'Modelo',
  modelAuto: '⚡ Auto',
  branchNew: '＋ Nova branch…',
  branchPlaceholder: 'nome da branch',
  emptyTitle: 'Kludge Code pronto',
  emptyHint: 'Enter — enviar · Shift+Enter — nova linha',
  placeholder: 'Escreva uma mensagem…',
  placeholderStreaming: 'Gerando… pressione Parar para editar',
  msgGitProgress: op => ({ add: '⏳ Executando `git add -A`…', commit: '⏳ Executando add + commit…', push: '⏳ Executando add + commit + push…' }[op]),
  msgGitAdded: '✓ Todas as alterações adicionadas (`git add -A`)',
  msgGitCommitted: msg => msg ? `✓ Commit: "${msg}"` : '✓ Commit realizado',
  msgGitPushed: msg => msg ? `✓ Commit "${msg}" e push realizado` : '✓ Push realizado',
  msgGitError: err => `⚠ Git: ${err}`,
  msgNpmStarted: cmd => `▶ Executando \`${cmd}\`…`,
  msgDevWaiting: ports => `🚀 \`npm run dev\` iniciado, aguardando servidor… (portas: ${ports})`,
  msgDevReady: url => `🚀 Servidor ativo → ${url} · abrindo preview`,
  msgDevTimeout: '⚠ Servidor não encontrado em 60s — abra o preview manualmente (⬡)',
  noWorkspaceHint: 'Abra uma pasta para usar npm e git',
  scopeLabelFile: 'Arquivo',
  scopeLabelProject: 'Projeto',
  scopePromptFile: p => `\n\nEscopo: apenas o arquivo \`${p}\`.`,
  scopePromptFolder: p => `\n\nEscopo: apenas a pasta \`${p}\`.`,
  scopePromptProject: '\n\nEscopo: projeto inteiro.',
  quickPromptTooltip: 'Enviar prompt rápido',
  quickRefactorLabel: 'Refatorar',
  quickTestsLabel: 'Testes',
  quickFixLabel: 'Corrigir erros',
  quickRefactorPrompt: 'Refatore o arquivo aberto: verifique a conformidade com as convenções do projeto, identifique e corrija antipadrões, más práticas, código duplicado, variáveis e importações não utilizadas, possíveis vazamentos de memória e violações de SOLID. Forneça recomendações específicas com explicações. Não quebre a lógica existente.',
  quickTestsPrompt: 'Verifique a cobertura de testes do arquivo aberto. Escreva os testes ausentes para atingir 80–90% de cobertura. Cubra casos extremos, cenários de erro e os principais fluxos de execução. Use o estilo e o framework de testes existentes no projeto. Não remova testes existentes.',
  quickFixPrompt: 'Encontre e corrija todos os erros no arquivo aberto: erros de TypeScript, erros de linter, erros de lógica, possíveis exceções em tempo de execução, tipos incorretos, problemas com async/await e quaisquer outros problemas. Para cada correção, explique brevemente o motivo.',
  quickActionLabel: 'Ação',
  quickActionWith: 'com',
  codeLinesLabel: n => `${n} linhas`,
  codeCopyBtn: 'copiar',
  removeElement: 'Remover',
  newPromptOption: '＋ Nova ação…',
  newPromptLabelPlaceholder: 'Nome da ação, ex. "Auditoria de segurança"',
  newPromptBoilerplate: 'Verifique o arquivo aberto em busca de [descreva o que procurar, ex. "vulnerabilidades"]. Para cada achado, explique o problema e mostre a correção. Não altere código não relacionado à tarefa.',
  newPromptSave: 'Salvar',
  newPromptCancel: 'Cancelar',
  modeAction: 'Permanente',
  modeTask: 'Único',
  scheduleConfirm: dt => `⏰ Agendado para ${dt}`,
  calendarToggle: '📅 Agenda',
  calendarNoTasks: 'Sem tarefas neste dia',
  calendarWeekdays: ['Se', 'Te', 'Qu', 'Qu', 'Se', 'Sá', 'Do'],
}

export function getStrings(locale: string): I18n {
  const l = locale.toLowerCase()
  if (l.startsWith('ru')) { return ru }
  if (l.startsWith('pt')) { return pt }
  return en
}
