---
inclusion: always
---

# Product: CivicQuest

CivicQuest helps schools and after-school programs teach civic sense to students in grades 2–12 through one short real-world mission each school day. It is a Hackachusetts entry in the Civic Action track, challenge V5: Pathways to education and opportunity.

## Users
- School admin: manages the school, classes, and students, and sees the proof log.
- Teacher (or after-school program staff): runs missions, confirms who took part, sets class rewards.
- Partner organization (food bank, park group): posts volunteer opportunities and approves hours.
- Leader (student in grades 9–12): checks in to volunteer opportunities and sees verified hours.
- Parents have no accounts.

## Levels (assigned automatically from grade)
- Learners, grades 2–5: class mode only. Stories feature Pip the fox, an original character.
- Helpers, grades 6–8: class mode only. Missions open with short case studies.
- Leaders, grades 9–12: own login, QR check-in at partner sites, partner approves hours.

## The roadmap
One mission per school day, Monday to Friday. Each week is one module of five missions. All 50 missions are in `docs/missions.md`.

## The core loop
1. The teacher shows the story or case study and asks the discussion question.
2. The class does the mission.
3. The teacher confirms who took part. That confirmation is the saved proof.
4. Balloons celebrate. Each student who took part gets points and a stamp for the mission’s quality. The class gets one building in its shared town.

## What each person gets
- Each student: points and a stamp passport (Safety, Kindness, Responsibility, Respect, Helping, Civic action), leading to badges. No ranking against classmates.
- Each class: a shared town that grows one building per mission, with teacher-set rewards at 10 (village), 25 (town), and 36 buildings (city).
- Leaders: verified service hours and a printable certificate.

## Proof by level
- Grades 2–5: the teacher watched it happen, saved with their name, the time, and who was absent.
- Grades 6–8: a photo of the place or the work, never of faces, approved by the teacher.
- Grades 9–12: QR check-in and check-out timestamps plus approval from a supervisor who was there.
- Every confirmation goes into a proof log that can’t be edited.
- Mistakes are easy to fix: for 24 hours, the teacher can edit who took part or undo the mission with a reason. Both are logged, and nothing is ever deleted.

## Why it matters
Massachusetts law requires every public school serving 8th grade and every high school to provide at least one student-led, non-partisan civics project per student. The Civics Project module supports that requirement.

## Product rules
- Every teacher action takes under two minutes a day. Confirming a whole class is one tap.
- No grades and no failing. Wrong quiz answers explain the right answer and allow another try.
- All civics content is non-partisan.
- The class town is the memorable element. Keep other screens calm.

## Specification
The complete requirements are in `docs/build-prompt.md`. The intended flow is in `docs/simulation.html`. The look is in `.kiro/steering/design.md`.
