# Tracker: files

The default, with no account needed. Each ticket is a markdown file with front matter at `<tracker.path>/<spec>/tickets/NN.md` (default `.ship/work`). Ids are `<spec>-NN`. Commit these files; they are the project's ticket history.

Run by the CLI: use `ship tracker get|list|next|transition`. Don't edit ticket status by hand.
