# GitHub 운영 계획

## 1. 운영 목적

이 저장소를 단순한 코드 저장 공간이 아니라, 팀의 개발 과정과 협업 기록을 확인할 수 있는 프로젝트 저장소로 운영합니다.

## 3. 브랜치 이름 규칙

```text
{작업 유형}/{작업 내용}
```

예시:

```text
docs/readme
feature/model-training
feature/stt-pipeline
feature/streamlit-ui
test/model-evaluation
```

### 3. 작업 유형

| 작업 유형  | 용도        | 예시                       |
| ---------- | ----------- | -------------------------- |
| `feature`  | 기능 추가   | `feature/model-training`   |
| `fix`      | 오류 수정   | `fix/upload-error`         |
| `refactor` | 구조 개선   | `refactor/pipeline-module` |
| `docs`     | 문서 수정   | `docs/readme`              |
| `test`     | 테스트·평가 | `test/model-evaluation`    |

작업 내용은 짧고 구체적인 영문 소문자로 작성합니다. 공백 대신 하이픈을 사용합니다.

## 4. 작업 흐름

브랜치를 생성하기 전에는 반드시 최신 `main`을 기준으로 작업해야 합니다. 아래 순서를 생략하거나 다른 브랜치에서 새 브랜치를 분기해서는 안 됩니다.

1. `main` 브랜치로 이동합니다.
2. `origin/main`의 최신 변경사항을 fast-forward 방식으로 반영합니다.
3. 최신화된 `main`에서 새 작업 브랜치를 생성합니다.

```text
작업 내용 확인
    ↓
main 브랜치 이동 및 origin/main 최신화
    ↓
개인 번호를 증가시킨 브랜치 생성
    ↓
작업 단위로 Commit
    ↓
원격 Branch Push
    ↓
Pull Request 생성
    ↓
팀원 Review
    ↓
승인 후 Merge
```

브랜치 생성 예시:

```bash
git switch main
git pull --ff-only origin main
git switch -c docs/github-workflow
```

위 순서는 필수입니다. `main`을 최신화하지 않았거나 `main`이 아닌 브랜치에서 분기한 브랜치는 작업 브랜치로 사용하지 않습니다.

커밋 및 push 예시:

```bash
git add docs/github-workflow.md
git commit -m "docs: GitHub 운영 계획 추가"
git push -u origin docs/github-workflow
```

## 5. 브랜치 점검 체크리스트

- 브랜치를 생성하기 전에 `main`으로 이동했는가?
- 브랜치 생성 직전에 `git pull --ff-only origin main`으로 `main`을 최신화했는가?
- 최신화된 `main`에서 작업 브랜치를 분기했는가?
- 작업 유형이 `feature`, `fix`, `refactor`, `docs`, `test` 중 하나인가?
- 작업 내용이 브랜치 이름만으로 이해되는가?
- 한 브랜치에 하나의 작업 목적만 포함되어 있는가?
- 작업 완료 후 PR과 Review 기록이 남아 있는가?
