# Guía de contribución

Este repositorio se trabaja como en una empresa: **todo cambio entra por una rama y un Pull Request, con la CI en verde
y commits que se entienden solos**. Aplica a todos (también a quien trabaja solo y a los agentes de IA).

## Ramas (Gitflow)

| Rama | Para qué | Quién escribe en ella |
|---|---|---|
| `main` | Lo que está en producción. Cada versión lleva etiqueta `vX.Y.Z`. | Solo `release/*` y `hotfix/*` por PR |
| `develop` | Integración: lo siguiente que saldrá a producción. | Solo `feature/*`, `fix/*` y `docs/*` por PR |
| `feature/<tema>` | Una funcionalidad nueva. Sale de `develop`. | Quien la desarrolla |
| `fix/<tema>` | Corrección de un error. Sale de `develop`. | Quien la corrige |
| `docs/<tema>` | Solo documentación. | |
| `release/X.Y.Z` | Congela `develop` para publicar: solo ajustes finales y versión. | |
| `hotfix/<tema>` | Error urgente en producción. Sale de `main`, vuelve a `main` **y** a `develop`. | |

Nunca se hace commit ni push directo a `main` ni a `develop` (está protegido).

## Commits

Formato [Conventional Commits](https://www.conventionalcommits.org/es/) en español, en imperativo y descriptivos:
`feat(heladeria): ...`, `fix(data): ...`, `test(ci): ...`, `docs: ...`, `chore: ...`, `ci: ...`. Nunca `fix`, `cambios` o `wip`.

Un commit = **un cambio** y debe dejar la suite en verde. El mensaje lleva un cuerpo con:

1. **Contexto / problema**: qué pasaba y por qué importaba (con la fecha o el incidente si lo hubo).
2. **Cambio**: qué se hizo y por qué así.
3. **Pruebas**: cómo se verificó.

## Pull Requests

- Descripción con **qué cambia, por qué, cómo se probó y qué falta** (hay una plantilla).
- La CI (`test-and-scan`) debe estar en verde. Se integra con **merge commit** (no squash) para conservar el historial
  commit a commit.
- Un PR pequeño y enfocado se revisa y se revierte mejor que uno enorme. Si un tema crece, se apila (el PR se apoya en
  la rama del anterior) y se reapunta a `develop` al integrar el de abajo.

## Pruebas

- Cobertura real de la lógica de negocio, incluidos los casos borde y no solo el camino feliz.
- **Las pruebas simulan la IA, siempre.** Ningún test, simulador ni script gasta tokens reales: `geminiGuard` lo bloquea
  y exige `ALLOW_REAL_AI=1` explícito (decisión del dueño del proyecto). Ver `AGENTS.md`.
- Las pruebas son herméticas: no dependen de un `.env`, de un Django en `localhost:8000` ni de datos de producción.
  `scripts/run-tests.js` levanta un backend falso y fija el entorno.
- Comandos: `npm test` (en `bot-wasap/`), `node tests_sim/run.js` (simulador, conversaciones completas) y
  `node tests_sim/run-agent.js` (con el agente).

## Código

Sin código comentado, sin variables sin usar, sin números ni textos "mágicos", nombres descriptivos, una
responsabilidad por función, lógica repetida más de dos veces se abstrae. Los secretos nunca se versionan (la CI corre
`gitleaks`).

## Publicar una versión

1. `git switch -c release/X.Y.Z develop` y ajustar versión y `CHANGELOG`.
2. PR `release/X.Y.Z` → `main`; con la CI en verde, merge y etiqueta `vX.Y.Z`.
3. Volver a integrar `main` en `develop` (PR `main` → `develop`) para que no se pierdan los ajustes de la release.

Un error urgente en producción: `hotfix/<tema>` desde `main`, PR a `main` (con etiqueta de parche) y luego a `develop`.
