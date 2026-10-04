// Example data so the app can be tried before the real catalogue is loaded.
// Every row is marked as demo and can be removed from Ajustes. Names are invented.

// [title, author, copies, age-band colour]
export const BOOKS = [
  ["Cuentos de la selva", "Horacio Quiroga", 3, "rojo"],
  ["Matilda", "Roald Dahl", 2, "rojo"],
  ["El Principito", "Antoine de Saint-Exupéry", 3, "verde"],
  ["Pateando lunas", "Roy Berocay", 2, "rojo"],
  ["Ruperto detective", "Roy Berocay", 1, "rojo"],
  ["Charlie y la fábrica de chocolate", "Roald Dahl", 2, "verde"],
  ["El monstruo de colores", "Anna Llenas", 2, "azul"],
  ["Donde viven los monstruos", "Maurice Sendak", 1, "azul"],
  ["Harry Potter y la piedra filosofal", "J. K. Rowling", 2, "verde"],
  ["Las aventuras de Pinocho", "Carlo Collodi", 1, "azul"],
  ["Mafalda 1", "Quino", 2, "verde"],
  ["El Superzorro", "Roald Dahl", 1, "rojo"],
];

// [name, class]
export const STUDENTS = [
  ["Martina López", "4°B"],
  ["Joaquín Pereira", "4°B"],
  ["Agustina Silva", "4°B"],
  ["Facundo Martínez", "4°A"],
  ["Lucía Fernández", "4°A"],
  ["Bruno Rodríguez", "3°B"],
  ["Sofía González", "3°B"],
  ["Thiago Suárez", "3°B"],
  ["Emma Acosta", "2°A"],
  ["Benjamín Castro", "2°A"],
  ["Catalina Núñez", "5°A"],
  ["Felipe Méndez", "5°A"],
  ["Julieta Sosa", "6°B"],
  ["Lautaro Ramos", "6°B"],
  ["Renata Díaz", "6°B"],
];

// [book index, copy index, student index, lent N days ago, loan length in days, returned N days ago or null]
export const LOANS = [
  [1, 0, 0, 3, 14, null],
  [0, 0, 1, 5, 14, null],
  [6, 0, 8, 1, 14, null],
  [8, 0, 12, 6, 14, null],
  [10, 0, 5, 0, 14, null],
  [3, 0, 3, 9, 14, null],
  [2, 0, 6, 20, 14, null],
  [5, 1, 13, 25, 14, null],
  [7, 0, 9, 16, 14, null],
  [1, 1, 2, 40, 14, 30],
  [0, 1, 0, 60, 14, 50],
  [2, 1, 4, 35, 14, 22],
  [8, 1, 11, 28, 14, 15],
  [1, 0, 10, 45, 14, 33],
  [11, 0, 7, 18, 14, 10],
  [3, 1, 14, 30, 14, 17],
  [6, 1, 9, 50, 14, 38],
  [1, 1, 3, 20, 14, 8],
  [4, 0, 1, 26, 14, 12],
];
