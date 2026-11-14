-- Clearly marked sample course content for project demonstrations.
-- Does not create accounts or fabricate student submissions/results.
DO $$
DECLARE
  sample_author_id bigint;
BEGIN
  SELECT id INTO sample_author_id
  FROM public.profiles
  ORDER BY CASE role WHEN 'manager' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, id
  LIMIT 1;

  IF sample_author_id IS NULL THEN
    RAISE NOTICE 'StudyMate sample content was not inserted: create at least one account first, then rerun this migration.';
    RETURN;
  END IF;

  INSERT INTO public.course_materials (title, course, description, resource_type, created_by)
  SELECT v.title, v.course, v.description, v.resource_type, sample_author_id
  FROM (VALUES
    ('Sample: Data Structures Revision Notes', 'Data Structures', 'Demonstration notes covering arrays, linked lists, stacks, queues, and trees.', 'Study guide'),
    ('Sample: Database Normalization Guide', 'Database Systems', 'Demonstration guide to 1NF, 2NF, 3NF, keys, and functional dependencies.', 'Lecture notes'),
    ('Sample: Graph Traversal Practice', 'Data Structures', 'Practice outline for breadth-first search and depth-first search.', 'Practice sheet')
  ) AS v(title, course, description, resource_type)
  WHERE NOT EXISTS (SELECT 1 FROM public.course_materials m WHERE m.title = v.title);

  INSERT INTO public.assignments (title, course, instructions, due_date, created_by)
  SELECT v.title, v.course, v.instructions, CURRENT_DATE + v.days_until_due, sample_author_id
  FROM (VALUES
    ('Sample: Linked List Exercises', 'Data Structures', 'Implement insertion and deletion, then explain the time complexity of each operation.', 7),
    ('Sample: ER Diagram Exercise', 'Database Systems', 'Create an ER diagram for a library system with books, members, and loans.', 12),
    ('Sample: CPU Scheduling Worksheet', 'Operating Systems', 'Solve the sample FCFS and Round Robin scheduling problems and compare waiting times.', 18)
  ) AS v(title, course, instructions, days_until_due)
  WHERE NOT EXISTS (SELECT 1 FROM public.assignments a WHERE a.title = v.title);

  INSERT INTO public.quizzes (title, course, questions, created_by)
  SELECT v.title, v.course, v.questions::jsonb, sample_author_id
  FROM (VALUES
    ('Sample: Data Structures Quick Quiz', 'Data Structures', '[{"prompt":"Which structure follows LIFO order?","options":["Queue","Stack","Tree"],"answer":1},{"prompt":"Which traversal uses a queue?","options":["BFS","DFS","In-order"],"answer":0}]'),
    ('Sample: Database Fundamentals Quiz', 'Database Systems', '[{"prompt":"Which key uniquely identifies a table row?","options":["Foreign key","Primary key","Partial key"],"answer":1},{"prompt":"Which normal form removes partial dependency?","options":["1NF","2NF","3NF"],"answer":1}]'),
    ('Sample: Operating Systems Quiz', 'Operating Systems', '[{"prompt":"Which is a preemptive scheduling algorithm?","options":["FCFS","Round Robin","Non-preemptive SJF"],"answer":1},{"prompt":"What does CPU stand for?","options":["Central Processing Unit","Computer Primary Utility","Core Program Unit"],"answer":0}]')
  ) AS v(title, course, questions)
  WHERE NOT EXISTS (SELECT 1 FROM public.quizzes q WHERE q.title = v.title);

  INSERT INTO public.study_notifications (title, body, created_by)
  SELECT v.title, v.body, sample_author_id
  FROM (VALUES
    ('Sample announcement: Data Structures review', 'Sample data: A revision session is scheduled for Thursday at 3:00 PM in Lab 2.'),
    ('Sample announcement: Assignment reminders', 'Sample data: Check the sample assignment deadlines in the Assignments section.'),
    ('Sample announcement: Quiz practice available', 'Sample data: Two-question practice quizzes are available for Data Structures, Database Systems, and Operating Systems.')
  ) AS v(title, body)
  WHERE NOT EXISTS (SELECT 1 FROM public.study_notifications n WHERE n.title = v.title);
END $$;
