# In-page designer agentlet (phase 2)

Not started. This folder will hold an agentlet, built on agentlet-core, that
runs on the target page itself: it inspects the DOM with `forms.extract`
and `tables.extract`, sends the observation and `../shared/recipe.md` to an
LLM, and produces a module or a brief for the Claude Code skill.
