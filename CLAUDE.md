# Claude Code Instructions for seoranko-com

## Git Workflow

**ALWAYS commit directly to main. Never create a feature branch.**

After every change:
```
git add . && git commit -m 'message' && git push origin main
```

Never use `git checkout -b`, never create a new branch. Every commit goes directly to main immediately. This is a solo project with no code review process — feature branches only add confusion and deployment delays.
