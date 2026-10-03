"""Behaviour of the registry through its public interface, against a real SQLite file."""
import os
import sys
import tempfile
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))

from registry import Registry, RegistryError  # noqa: E402


class Clock:
    def __init__(self, day: date):
        self.day = day

    def __call__(self):
        return self.day


class RegistryTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.clock = Clock(date(2026, 10, 1))
        self.r = Registry(os.path.join(self.dir.name, "t.db"), today=self.clock)
        self.matilda = self.r.add_book("Matilda", "Roald Dahl", copies=2)
        self.principito = self.r.add_book("El Principito", "Saint-Exupéry")
        self.martina = self.r.add_student("Martina López", "4b")
        self.joaquin = self.r.add_student("Joaquín Pereira", "4°B")
        self.bruno = self.r.add_student("Bruno Rodríguez", "3 B")

    def tearDown(self):
        self.r.db.close()
        self.dir.cleanup()

    def code(self, book, i=0):
        return book["copies"][i]["code"]

    # ── books & students ──
    def test_copies_get_sequential_codes_and_custom_codes_are_kept(self):
        self.assertEqual([c["code"] for c in self.matilda["copies"]], ["B-0001", "B-0002"])
        self.assertEqual(self.code(self.principito), "B-0003")
        b = self.r.add_book("Mafalda", "Quino", codes=["q-7"])
        self.assertEqual(self.code(b), "Q-7")
        with self.assertRaises(RegistryError) as e:
            self.r.add_book("Otro", codes=["Q-7"])
        self.assertEqual(e.exception.code, "code_taken")

    def test_grades_are_tidied_so_the_same_class_matches(self):
        self.assertEqual(self.martina["grade"], "4°B")
        self.assertEqual(self.bruno["grade"], "3°B")
        self.assertEqual(self.r.grades(), ["3°B", "4°B"])
        self.assertEqual([s["name"] for s in self.r.students(grade="4 b")], ["Joaquín Pereira", "Martina López"])

    def test_blank_title_or_name_is_refused(self):
        with self.assertRaises(RegistryError):
            self.r.add_book("   ")
        with self.assertRaises(RegistryError):
            self.r.add_student("")

    # ── lending ──
    def test_lend_sets_due_date_from_settings_and_marks_copy_unavailable(self):
        loan = self.r.lend("b-0001", self.martina["id"])
        self.assertEqual(loan["due_on"], "2026-10-15")
        self.assertEqual(loan["student"], "Martina López")
        book = self.r.book(self.matilda["id"])
        self.assertEqual(book["available"], 1)
        self.assertEqual(book["copies"][0]["loan"]["student"], "Martina López")

    def test_a_copy_cannot_be_lent_twice(self):
        self.r.lend("B-0001", self.martina["id"])
        with self.assertRaises(RegistryError) as e:
            self.r.lend("B-0001", self.joaquin["id"], force=True)
        self.assertEqual(e.exception.code, "copy_on_loan")
        self.assertEqual(e.exception.info["loan"]["student"], "Martina López")

    def test_limit_warns_but_can_be_overridden(self):
        self.r.update_settings(max_loans=1)
        self.r.lend("B-0001", self.martina["id"])
        with self.assertRaises(RegistryError) as e:
            self.r.lend("B-0003", self.martina["id"])
        self.assertEqual(e.exception.code, "needs_confirmation")
        loan = self.r.lend("B-0003", self.martina["id"], force=True)
        self.assertTrue(loan["open"])
        self.assertEqual(len(self.r.student(self.martina["id"])["loans"]), 2)

    def test_overdue_books_trigger_a_warning(self):
        self.r.lend("B-0001", self.martina["id"])
        self.clock.day += timedelta(days=20)
        with self.assertRaises(RegistryError) as e:
            self.r.lend("B-0003", self.martina["id"])
        self.assertIn("Matilda", e.exception.message)

    def test_custom_due_date_and_past_dates_refused(self):
        loan = self.r.lend("B-0001", self.martina["id"], due_on="2026-10-30")
        self.assertEqual(loan["due_on"], "2026-10-30")
        with self.assertRaises(RegistryError):
            self.r.lend("B-0002", self.joaquin["id"], due_on="2026-09-01")

    # ── returning ──
    def test_return_closes_the_loan_and_keeps_history(self):
        loan = self.r.lend("B-0001", self.martina["id"])
        self.clock.day += timedelta(days=3)
        back = self.r.return_copy("B-0001")
        self.assertEqual(back["returned_on"], "2026-10-04")
        self.assertEqual(self.r.book(self.matilda["id"])["available"], 2)
        hist = self.r.student_history(self.martina["id"])
        self.assertEqual([h["id"] for h in hist], [loan["id"]])
        self.assertFalse(hist[0]["open"])

    def test_returning_a_copy_that_is_not_out_fails(self):
        with self.assertRaises(RegistryError) as e:
            self.r.return_copy("B-0001")
        self.assertEqual(e.exception.code, "not_on_loan")

    def test_undo_return_reopens_unless_lent_again(self):
        loan = self.r.lend("B-0001", self.martina["id"])
        self.r.return_copy("B-0001")
        self.assertTrue(self.r.undo_return(loan["id"])["open"])
        self.r.return_copy("B-0001")
        self.r.lend("B-0001", self.joaquin["id"])
        with self.assertRaises(RegistryError):
            self.r.undo_return(loan["id"])

    def test_renew_counts_a_full_period_from_today(self):
        loan = self.r.lend("B-0001", self.martina["id"])
        self.clock.day += timedelta(days=10)
        self.assertEqual(self.r.renew(loan["id"])["due_on"], "2026-10-25")

    # ── questions ──
    def test_overdue_lists_only_late_open_loans_with_days_late(self):
        self.r.lend("B-0001", self.martina["id"])
        self.r.lend("B-0003", self.joaquin["id"], due_on="2026-10-30")
        self.clock.day = date(2026, 10, 20)
        late = self.r.overdue()
        self.assertEqual([(l["student"], l["days_late"]) for l in late], [("Martina López", 5)])
        self.assertEqual(self.r.ask("¿Qué está atrasado?")["kind"], "overdue")

    def test_ask_who_has_a_book_ignores_accents_and_question_words(self):
        self.r.lend("B-0003", self.joaquin["id"])
        ans = self.r.ask("¿Quién tiene el principito?")
        self.assertEqual(ans["kind"], "search")
        self.assertEqual(ans["books"][0]["copies"][0]["loan"]["student"], "Joaquín Pereira")
        ans = self.r.ask("joaquin")
        self.assertEqual(ans["students"][0]["loans"][0]["title"], "El Principito")

    def test_ask_by_copy_code_and_by_class(self):
        self.assertEqual(self.r.ask("b-0002")["books"][0]["title"], "Matilda")
        self.r.lend("B-0001", self.martina["id"])
        ans = self.r.ask("4°B")
        self.assertEqual(ans["kind"], "grade")
        self.assertEqual(len(ans["students"]), 2)
        self.assertEqual([l["student"] for l in ans["loans"]], ["Martina López"])

    def test_most_read_counts_every_loan(self):
        for _ in range(2):
            self.r.lend("B-0001", self.martina["id"], force=True)
            self.r.return_copy("B-0001")
        self.r.lend("B-0003", self.martina["id"], force=True)
        top = self.r.ask("más leídos")["books"]
        self.assertEqual([(b["title"], b["times_lent"]) for b in top], [("Matilda", 2), ("El Principito", 1)])

    def test_counter_suggestions_split_available_and_on_loan(self):
        self.r.lend("B-0001", self.martina["id"])
        lend = self.r.suggest_copies("matil", "lend")
        self.assertEqual([c["code"] for c in lend], ["B-0002"])
        ret = self.r.suggest_copies("martina", "return")
        self.assertEqual([(c["code"], c["student"]) for c in ret], [("B-0001", "Martina López")])

    # ── archive & import/export ──
    def test_archive_is_refused_while_books_are_out(self):
        self.r.lend("B-0001", self.martina["id"])
        with self.assertRaises(RegistryError):
            self.r.set_student_archived(self.martina["id"], True)
        with self.assertRaises(RegistryError):
            self.r.set_book_archived(self.matilda["id"], True)
        self.r.return_copy("B-0001")
        self.assertTrue(self.r.set_student_archived(self.martina["id"], True)["archived"])
        self.assertEqual(len(self.r.student_history(self.martina["id"])), 1)

    def test_import_students_and_books_from_excel_style_csv(self):
        res = self.r.import_csv("students", "Nombre;Clase\nAna Gómez;5a\nMartina López;4°B\n")
        self.assertEqual((res["added"], res["skipped"]), (1, 1))
        self.assertEqual(self.r.students(grade="5A")[0]["name"], "Ana Gómez")
        res = self.r.import_csv("books", "titulo,autor,ejemplares\nCorazón,Edmundo de Amicis,3\n,sin titulo,1\n")
        self.assertEqual(res["added"], 1)
        self.assertEqual(len(res["errors"]), 1)
        self.assertEqual(self.r.ask("corazon")["books"][0]["total"], 3)

    def test_export_loans_csv_has_states(self):
        self.r.lend("B-0001", self.martina["id"])
        self.clock.day = date(2026, 11, 1)
        text = self.r.export_csv("loans")
        self.assertIn("Matilda;Roald Dahl;Martina López;4°B;01/10/2026;15/10/2026;;Atrasado", text)

    def test_demo_data_loads_and_clears_without_touching_real_rows(self):
        self.r.lend("B-0001", self.martina["id"])
        self.r.load_demo()
        self.assertTrue(self.r.summary()["has_demo"])
        self.assertGreater(len(self.r.overdue()), 0)
        self.r.clear_demo()
        s = self.r.summary()
        self.assertFalse(s["has_demo"])
        self.assertEqual((s["books"], s["students"], s["open"]), (2, 3, 1))


if __name__ == "__main__":
    unittest.main()
