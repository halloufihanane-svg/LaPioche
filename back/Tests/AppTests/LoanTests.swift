@testable import App
import XCTVapor

final class LoanTests: XCTestCase {
    private func borrow(
        _ app: Application,
        gameID: UUID,
        memberID: UUID,
        afterResponse: (XCTHTTPResponse) async throws -> Void
    ) async throws {
        try await app.test(.POST, "loans", beforeRequest: { req in
            try req.content.encode(CreateLoanDTO(gameID: gameID, memberID: memberID))
        }, afterResponse: afterResponse)
    }

    func testBorrowGameReturnsCreated() async throws {
        try await withApp { app in
            let game = try await createGame(app)
            let member = try await createMember(app)

            try await borrow(
                app, gameID: try XCTUnwrap(game.id), memberID: try XCTUnwrap(member.id)
            ) { res in
                XCTAssertEqual(res.status, .created)
                let loan = try res.content.decode(LoanDTO.self)
                XCTAssertEqual(loan.gameID, game.id)
                XCTAssertEqual(loan.memberID, member.id)
                XCTAssertNil(loan.returnedAt)
            }
        }
    }

    func testDueDateIsFourteenDaysAfterBorrowDate() async throws {
        try await withApp { app in
            let game = try await createGame(app)
            let member = try await createMember(app)

            try await borrow(
                app, gameID: try XCTUnwrap(game.id), memberID: try XCTUnwrap(member.id)
            ) { res in
                let loan = try res.content.decode(LoanDTO.self)
                var calendar = Calendar(identifier: .gregorian)
                calendar.timeZone = TimeZone(secondsFromGMT: 0)!
                let days = calendar.dateComponents([.day], from: loan.borrowedAt, to: loan.dueAt).day
                XCTAssertEqual(days, 14)
            }
        }
    }

    func testBorrowedGameIsNoLongerAvailable() async throws {
        try await withApp { app in
            let game = try await createGame(app)
            let member = try await createMember(app)
            let gameID = try XCTUnwrap(game.id)

            try await borrow(app, gameID: gameID, memberID: try XCTUnwrap(member.id)) { _ in }

            try await app.test(.GET, "games/\(gameID)", afterResponse: { res async throws in
                XCTAssertFalse(try res.content.decode(GameDTO.self).isAvailable)
            })
        }
    }

    func testBorrowingAGameAlreadyOnLoanReturnsConflict() async throws {
        try await withApp { app in
            let game = try await createGame(app)
            let first = try await createMember(app, email: "first@example.com")
            let second = try await createMember(app, name: "Alex", email: "second@example.com")
            let gameID = try XCTUnwrap(game.id)

            try await borrow(app, gameID: gameID, memberID: try XCTUnwrap(first.id)) { _ in }
            try await borrow(app, gameID: gameID, memberID: try XCTUnwrap(second.id)) { res in
                XCTAssertEqual(res.status, .conflict)
            }
        }
    }

    func testBorrowUnknownGameReturnsNotFound() async throws {
        try await withApp { app in
            let member = try await createMember(app)

            try await borrow(app, gameID: UUID(), memberID: try XCTUnwrap(member.id)) { res in
                XCTAssertEqual(res.status, .notFound)
            }
        }
    }

    func testBorrowWithUnknownMemberReturnsNotFound() async throws {
        try await withApp { app in
            let game = try await createGame(app)

            try await borrow(app, gameID: try XCTUnwrap(game.id), memberID: UUID()) { res in
                XCTAssertEqual(res.status, .notFound)
            }
        }
    }
    
    func testOverdueLoansReturnsOnlyUnreturnedPastDueLoans() async throws { // Phase 3 : Test créé pour tester à 100% la FEAT-05
            try await withApp { app in
                // 1. Création d'un adhérent et de 3 jeux via les helpers existants
                let member = try await createMember(app)
                let game1 = try await createGame(app, title: "Jeu en retard")
                let game2 = try await createGame(app, title: "Jeu rendu en retard")
                let game3 = try await createGame(app, title: "Jeu dans les temps")

                let memberID = try XCTUnwrap(member.id)
                let yesterday = Date().addingTimeInterval(-86_400) // Il y a 24h
                let tomorrow = Date().addingTimeInterval(86_400)   // Dans 24h
                let lastWeek = Date().addingTimeInterval(-7 * 86_400)

                // Cas 1 : Emprunt non rendu et date limite dépassée -> DOIT être renvoyé
                let overdueLoan = Loan(
                    gameID: try XCTUnwrap(game1.id),
                    memberID: memberID,
                    borrowedAt: lastWeek,
                    dueAt: yesterday
                )
                try await overdueLoan.save(on: app.db)

                // Cas 2 : Emprunt dont la date limite est dépassée MAIS déjà rendu -> NE DOIT PAS être renvoyé
                let returnedLateLoan = Loan(
                    gameID: try XCTUnwrap(game2.id),
                    memberID: memberID,
                    borrowedAt: lastWeek,
                    dueAt: yesterday
                )
                returnedLateLoan.returnedAt = Date()
                try await returnedLateLoan.save(on: app.db)

                // Cas 3 : Emprunt non rendu mais date limite dans le futur -> NE DOIT PAS être renvoyé
                let activeLoan = Loan(
                    gameID: try XCTUnwrap(game3.id),
                    memberID: memberID,
                    borrowedAt: Date(),
                    dueAt: tomorrow
                )
                try await activeLoan.save(on: app.db)

                // 2. Appel de la route GET /loans/overdue et vérifications
                try await app.test(.GET, "loans/overdue", afterResponse: { res async throws in
                    XCTAssertEqual(res.status, .ok)
                    let results = try res.content.decode([LoanDTO].self)
                    XCTAssertEqual(results.count, 1)
                    XCTAssertEqual(results.first?.id, overdueLoan.id)
                })
            }
        }
}
